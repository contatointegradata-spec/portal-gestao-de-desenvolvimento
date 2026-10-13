import { getDb } from "../db.js";
import { isManager, requireAuth } from "../lib/auth.js";
import { asyncRouter, forbidden, notFound, parseJson } from "../lib/http.js";
import { cancelRun, getActiveRun, listActiveRuns, subscribe } from "../rpa/runner.js";
import { canAccessProject, canRunProject } from "./projects.js";

const router = asyncRouter();

async function loadRunWithProject(db, user, runId) {
  const run = await db.get(
    `SELECT r.*, p.nome AS projectName, p.responsibleUserId, p.systemType, u.nome AS triggeredByName
     FROM project_runs r
     JOIN projects p ON p.id = r.projectId
     LEFT JOIN users u ON u.id = r.triggeredByUserId
     WHERE r.id = ?`,
    runId
  );
  if (!run || !canAccessProject(user, { responsibleUserId: run.responsibleUserId })) throw notFound("Execucao nao encontrada.");
  return run;
}

async function serializeRunDetail(db, run) {
  const artifacts = await db.all(
    "SELECT id, fileName, mimeType, fileSize, createdAt FROM project_run_artifacts WHERE runId = ? ORDER BY fileName",
    run.id
  );
  const events = parseJson(run.events, null);
  return {
    id: run.id,
    projectId: run.projectId,
    projectName: run.projectName,
    triggerType: run.triggerType,
    triggerValue: run.triggerValue || "",
    triggeredByName: run.triggeredByName || "",
    language: run.language,
    runnerName: run.runnerName || "",
    status: run.status,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    errorMessage: run.errorMessage || "",
    // Execucoes antigas (antes do log estruturado) exibem stdout/stderr como texto.
    events: Array.isArray(events) ? events : null,
    stdout: Array.isArray(events) ? "" : run.stdout || "",
    stderr: run.stderr || "",
    lastScreenshot: run.lastScreenshot || null,
    artifacts: artifacts.map((item) => ({ ...item, fileSize: Number(item.fileSize || 0) })),
    createdAt: run.createdAt,
    finishedAt: run.finishedAt
  };
}

router.get("/active", requireAuth, async (req, res) => {
  const db = await getDb();
  const active = listActiveRuns();
  if (isManager(req.user)) return res.json(active);
  const own = await db.all("SELECT id FROM projects WHERE responsibleUserId = ?", req.user.id);
  const ownIds = new Set(own.map((row) => row.id));
  res.json(active.filter((run) => ownIds.has(run.projectId)));
});

router.get("/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const run = await loadRunWithProject(db, req.user, req.params.id);
  res.json(await serializeRunDetail(db, run));
});

/**
 * Stream SSE da execucao: envia um "snapshot" (logs ja emitidos + ultima captura),
 * depois eventos "log", "screenshot" e por fim "done".
 */
router.get("/:id/stream", requireAuth, async (req, res) => {
  const db = await getDb();
  const run = await loadRunWithProject(db, req.user, req.params.id);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const state = getActiveRun(run.id);
  if (!state || state.status !== "running") {
    const detail = await serializeRunDetail(db, await loadRunWithProject(db, req.user, run.id));
    send("snapshot", { ...detail, lastScreenshot: detail.lastScreenshot ? { image: detail.lastScreenshot, label: "Ultima captura", url: "" } : null });
    send("done", detail);
    return res.end();
  }

  send("snapshot", state.snapshot());
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  const unsubscribe = subscribe(run.id, async (type, payload) => {
    if (type !== "done") return send(type, payload);
    clearInterval(heartbeat);
    const detail = await serializeRunDetail(db, await loadRunWithProject(db, req.user, run.id));
    send("done", { ...detail, artifacts: payload.artifacts || detail.artifacts });
    res.end();
  });
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe?.();
  });
});

router.post("/:id/cancel", requireAuth, async (req, res) => {
  const db = await getDb();
  const run = await loadRunWithProject(db, req.user, req.params.id);
  const project = { responsibleUserId: run.responsibleUserId, systemType: run.systemType };
  if (!canRunProject(req.user, project) && run.triggeredByUserId !== req.user.id) throw forbidden("Voce nao pode cancelar esta execucao.");
  await cancelRun(run.id, req.user.id);
  res.status(202).json({ ok: true });
});

router.get("/:id/artifacts/:artifactId/download", requireAuth, async (req, res) => {
  const db = await getDb();
  const run = await loadRunWithProject(db, req.user, req.params.id);
  const artifact = await db.get("SELECT * FROM project_run_artifacts WHERE id = ? AND runId = ?", req.params.artifactId, run.id);
  if (!artifact) throw notFound("Arquivo nao encontrado.");
  res.setHeader("Content-Type", artifact.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`);
  res.send(artifact.content);
});

export default router;
