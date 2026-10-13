// API usada pelo agente instalado nos servidores de execucao (autenticado pelo token do servidor).
import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { asyncRouter, HttpError, nowIso, trimText, wrapAsync } from "../lib/http.js";
import { hashToken } from "../lib/security.js";
import { isScreenWatched, pushScreenFrame, pushScreenStatus, requeueFront, takeNextJob, touchRunner, waitScreenDemand } from "../rpa/remote.js";
import { finishRemoteRun, getActiveRun, markRemotePicked, receiveRemoteArtifact, receiveRemoteOutput } from "../rpa/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_FILE = path.join(__dirname, "..", "rpa", "agent", "gestao-rpa-agent.cjs");
const SCREEN_SCRIPT_FILE = path.join(__dirname, "..", "rpa", "agent", "screen-capture.py");
export const AGENT_VERSION = "1.2.0";
const LONG_POLL_MS = 25 * 1000;
const DB_TOUCH_INTERVAL_MS = 60 * 1000;

const router = asyncRouter();
const dbTouchedAt = new Map();

const requireAgent = wrapAsync(async (req, _res, next) => {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Token do agente nao informado.");
  const db = await getDb();
  const runner = await db.get("SELECT id, nome, active FROM rpa_runners WHERE tokenHash = ?", hashToken(token));
  if (!runner) throw new HttpError(401, "Token do agente invalido. Gere um novo token em Configuracoes › Servidores RPA.");
  if (!runner.active) throw new HttpError(403, "Este servidor de execucao esta desativado na plataforma.");
  touchRunner(runner.id);
  const last = dbTouchedAt.get(runner.id) || 0;
  if (Date.now() - last > DB_TOUCH_INTERVAL_MS) {
    dbTouchedAt.set(runner.id, Date.now());
    await db.run("UPDATE rpa_runners SET lastSeenAt = ? WHERE id = ?", nowIso(), runner.id);
  }
  req.runner = runner;
  next();
});

function loadRemoteRun(req) {
  const state = getActiveRun(req.params.runId);
  if (!state || !state.remote || state.runnerId !== req.runner.id) return null;
  return state.status === "running" ? state : null;
}

// Download publico do agente (o arquivo nao contem segredos).
router.get("/download", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=gestao-rpa-agent.cjs");
  res.sendFile(AGENT_FILE);
});

// Script de captura de tela (o agente baixa e mantem atualizado ao lado dele).
router.get("/screen-script", requireAgent, (_req, res) => {
  res.setHeader("Content-Type", "text/x-python; charset=utf-8");
  res.sendFile(SCREEN_SCRIPT_FILE);
});

// ─── Tela ao vivo ─────────────────────────────────────────────────────────────
router.get("/screen/demand", requireAgent, async (req, res) => {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  const watching = await waitScreenDemand(req.runner.id, LONG_POLL_MS, controller.signal);
  if (!res.writableEnded && !req.socket.destroyed) res.json({ watching });
});

router.post(
  "/screen/frame",
  requireAgent,
  express.raw({ type: () => true, limit: 8 * 1024 * 1024 }),
  async (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (data.length) {
      pushScreenFrame(req.runner.id, { data, width: Number(req.headers["x-screen-width"]) || null, height: Number(req.headers["x-screen-height"]) || null });
    }
    res.json({ watching: isScreenWatched(req.runner.id) });
  }
);

router.post("/screen/status", requireAgent, async (req, res) => {
  pushScreenStatus(req.runner.id, { available: Boolean(req.body?.available), message: trimText(req.body?.message) });
  res.json({ watching: isScreenWatched(req.runner.id) });
});

router.post("/heartbeat", requireAgent, async (req, res) => {
  const body = req.body || {};
  const info = {
    hostname: trimText(body.hostname).slice(0, 120),
    username: trimText(body.username).slice(0, 120),
    platform: trimText(body.platform).slice(0, 40),
    node: trimText(body.node).slice(0, 40),
    python: trimText(body.python).slice(0, 80),
    playwrightNode: Boolean(body.playwrightNode),
    screenCapture: body.screenCapture === undefined ? null : Boolean(body.screenCapture),
    version: trimText(body.version).slice(0, 20),
    runningJobs: Number(body.runningJobs) || 0,
    reportedAt: nowIso()
  };
  const db = await getDb();
  await db.run("UPDATE rpa_runners SET agentInfo = ?, lastSeenAt = ? WHERE id = ?", JSON.stringify(info), nowIso(), req.runner.id);
  res.json({ ok: true, runner: req.runner.nome, latestVersion: AGENT_VERSION, pollMs: LONG_POLL_MS });
});

router.get("/jobs/next", requireAgent, async (req, res) => {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  const job = await takeNextJob(req.runner.id, LONG_POLL_MS, controller.signal);
  if (!job) return res.status(204).send();
  if (controller.signal.aborted || res.writableEnded || req.socket.destroyed) {
    requeueFront(req.runner.id, job);
    return undefined;
  }
  if (job.state.status !== "running") return res.status(204).send();
  markRemotePicked(job.state, { hostname: trimText(req.query.hostname) });
  res.json(job.payload);
  return undefined;
});

router.post("/runs/:runId/output", requireAgent, async (req, res) => {
  const state = loadRemoteRun(req);
  // Execucao encerrada na plataforma (cancelada, tempo esgotado, servidor reiniciado): o agente mata o processo.
  if (!state) return res.status(410).json({ cancel: true });
  const body = req.body || {};
  res.json(receiveRemoteOutput(state, {
    stdout: Array.isArray(body.stdout) ? body.stdout : [],
    stderr: Array.isArray(body.stderr) ? body.stderr : []
  }));
  return undefined;
});

router.post(
  "/runs/:runId/artifacts",
  requireAgent,
  express.raw({ type: () => true, limit: config.rpa.maxFileBytes * 2 }),
  async (req, res) => {
    const state = loadRemoteRun(req);
    if (!state) return res.status(410).json({ cancel: true });
    const name = decodeURIComponent(String(req.headers["x-file-name"] || ""));
    if (!name) throw new HttpError(400, "Nome do arquivo nao informado.");
    receiveRemoteArtifact(state, name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    res.status(201).json({ ok: true });
    return undefined;
  }
);

router.post("/runs/:runId/finish", requireAgent, async (req, res) => {
  const state = loadRemoteRun(req);
  if (!state) return res.status(410).json({ ok: false });
  await finishRemoteRun(state, Number(req.body?.exitCode));
  res.json({ ok: true });
  return undefined;
});

export default router;
