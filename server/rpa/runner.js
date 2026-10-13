import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config, ROOT_DIR } from "../config.js";
import { getDb } from "../db.js";
import { HttpError, truncate } from "../lib/http.js";
import { notifyManagers } from "../lib/notifications.js";
import { ensureDisplay, ensureLiveView } from "./display.js";
import { normalizeLanguage, resolveInterpreter } from "./interpreters.js";
import { dequeueJob, enqueueJob, isRunnerOnline } from "./remote.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRAPPERS = {
  javascript: path.join(__dirname, "wrappers", "wrapper.cjs"),
  python: path.join(__dirname, "wrappers", "wrapper.py")
};

const MAX_EVENTS = 4000;
const MAX_STDOUT_CHARS = 200_000;
const MAX_STDERR_CHARS = 50_000;
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACTS_BYTES = 50 * 1024 * 1024;
const KEEP_FINISHED_MS = 2 * 60 * 1000;
// Execucao remota: sem contato do agente por este tempo, a execucao e dada como perdida.
const REMOTE_SILENCE_MS = 90 * 1000;
const REMOTE_CANCEL_GRACE_MS = 30 * 1000;
const SENSITIVE_ENV = ["MAIL_USER", "MAIL_APP_PASSWORD", "MAIL_FROM", "APP_SECRET_KEY", "MASTER_EMAIL", "MASTER_PASSWORD", "MASTER_NAME", "DB_PATH"];

const activeRuns = new Map();

export const RUN_STATUS_LABELS = {
  running: "Em execucao",
  success: "Sucesso",
  error: "Falhou",
  timeout: "Tempo esgotado",
  cancelled: "Cancelada",
  interrupted: "Interrompida"
};

export function isEsmCode(code) {
  return /^\s*import\s[^(]*?from\s+["']/m.test(code) || /^\s*export\s+(default|const|function|async)/m.test(code);
}

export function sanitizeFileName(name) {
  const base = path.basename(String(name || "arquivo")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 180) : `arquivo_${Date.now()}`;
}

function guessMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".zip": "application/zip",
    ".xml": "application/xml",
    ".html": "text/html",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }[ext] || "application/octet-stream";
}

function resolveHeadless(browserMode, { remote = false } = {}) {
  // Agente remoto (Windows com area de trabalho): "auto" abre o navegador visivel na sessao do servidor.
  if (remote) return browserMode === "headless";
  if (browserMode === "headless") return true;
  if (browserMode === "visible") return false;
  if (config.rpa.headless) return !["0", "false", "no"].includes(config.rpa.headless.toLowerCase());
  // auto: Windows com area de trabalho mostra o navegador; Linux so se houver display (Xvfb).
  if (process.platform === "win32") return false;
  return !process.env.DISPLAY;
}

/** Tempo limite efetivo em segundos; 0 = sem limite. */
function resolveTimeout(project) {
  const value = Number(project.timeoutSeconds);
  if (value === 0) return 0;
  return Math.min(Math.max(value || config.rpa.defaultTimeoutSeconds, 10), config.rpa.maxTimeoutSeconds);
}

function formatLimit(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return seconds >= 60 ? `${Math.round(seconds / 6) / 10} min` : `${seconds}s`;
}

function timeoutMessage(seconds) {
  return `Tempo limite de ${formatLimit(seconds)} excedido. Encerrando a execucao. Para RPAs longos, aumente o limite ou escolha "Sem limite" em Editar › Execucao.`;
}

function buildEnv(extra) {
  const env = { ...process.env };
  for (const key of SENSITIVE_ENV) delete env[key];
  return {
    ...env,
    NODE_PATH: path.join(ROOT_DIR, "node_modules"),
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...extra
  };
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* ja finalizado */ }
  }, 5000).unref();
}

function linkNodeModules(workDir) {
  const target = path.join(ROOT_DIR, "node_modules");
  if (!existsSync(target)) return;
  try {
    symlinkSync(target, path.join(workDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  } catch {
    // NODE_PATH continua como alternativa para require()
  }
}

/** Resumo para cards e notificacoes: prioriza a ultima mensagem de sucesso/resultado. */
function summarizeMessages(events) {
  const meaningful = events.filter((event) => event.message && event.level !== "action" && event.level !== "progress");
  const success = [...meaningful].reverse().find((event) => event.level === "success");
  const chosen = success || meaningful.at(-1);
  return chosen ? String(chosen.message).split("\n")[0].slice(0, 300) : "";
}

function publicEvent(event) {
  const { image, ...rest } = event;
  return rest;
}

// ─── Estado em memoria ────────────────────────────────────────────────────────
class RunState {
  constructor({ runId, project, triggerType, triggerValue, userId, runner = null }) {
    this.id = runId;
    this.runnerId = runner?.id || null;
    this.runnerName = runner?.nome || "";
    // Execucao remota: estado da conversa com o agente do servidor.
    this.remote = runner ? { picked: false, lastContactAt: Date.now(), cancelRequestedAt: null, artifacts: [], artifactBytes: 0, timers: [] } : null;
    this.projectId = project.id;
    this.projectName = project.nome;
    this.language = project.runtimeLanguage;
    this.triggerType = triggerType;
    this.triggerValue = triggerValue;
    this.triggeredByUserId = userId;
    this.startedAt = new Date();
    this.status = "running";
    this.events = [];
    this.droppedEvents = 0;
    this.stdoutLines = [];
    this.stderr = "";
    this.lastScreenshot = null;
    this.liveView = null;
    this.listeners = new Set();
    this.child = null;
    this.timedOut = false;
    this.cancelledBy = null;
    this.finishedRun = null;
  }

  broadcast(type, payload) {
    for (const listener of this.listeners) {
      try { listener(type, payload); } catch { /* listener desconectado */ }
    }
  }

  pushEvent(event) {
    if (event.level === "screenshot") {
      this.lastScreenshot = { image: event.image, url: event.url || "", label: event.message || "", ts: event.ts };
      this.broadcast("screenshot", this.lastScreenshot);
      return;
    }
    const normalized = {
      ts: event.ts || new Date().toISOString(),
      level: ["info", "success", "warn", "error", "action", "progress"].includes(event.level) ? event.level : "info",
      message: truncate(event.message ?? "", 4000),
      ...(event.current !== undefined ? { current: event.current, total: event.total, percent: event.percent } : {})
    };
    if (this.events.length < MAX_EVENTS) this.events.push(normalized);
    else this.droppedEvents += 1;
    this.stdoutLines.push(`[${normalized.level}] ${normalized.message}`);
    this.broadcast("log", normalized);
  }

  setLiveView(liveView) {
    this.liveView = liveView;
    this.broadcast("liveview", liveView);
  }

  snapshot() {
    return {
      liveView: this.liveView,
      runnerId: this.runnerId,
      runnerName: this.runnerName,
      id: this.id,
      projectId: this.projectId,
      projectName: this.projectName,
      status: this.status,
      triggerType: this.triggerType,
      startedAt: this.startedAt.toISOString(),
      events: this.events,
      lastScreenshot: this.lastScreenshot,
      finishedRun: this.finishedRun
    };
  }
}

export function getActiveRun(runId) {
  return activeRuns.get(runId) || null;
}

export function getActiveRunForProject(projectId) {
  for (const run of activeRuns.values()) {
    if (run.projectId === projectId && run.status === "running") return run;
  }
  return null;
}

export function listActiveRuns() {
  return [...activeRuns.values()].filter((run) => run.status === "running").map((run) => ({
    id: run.id, projectId: run.projectId, projectName: run.projectName, startedAt: run.startedAt.toISOString(), triggerType: run.triggerType,
    runnerId: run.runnerId, runnerName: run.runnerName
  }));
}

export function subscribe(runId, listener) {
  const run = activeRuns.get(runId);
  if (!run) return null;
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

// ─── Execucao ─────────────────────────────────────────────────────────────────
export async function startRun({ project, triggerType = "manual", triggerValue = "", userId = null }) {
  const language = normalizeLanguage(project.runtimeLanguage);
  if (project.systemType !== "rpa") throw new HttpError(400, "Execucao disponivel apenas para sistemas RPA.");
  if (!language) throw new HttpError(400, "Linguagem do RPA nao configurada.");
  if (!String(project.code || "").trim()) throw new HttpError(400, "O RPA nao possui codigo para executar.");

  const db = await getDb();
  let runner = null;
  let interpreter = null;
  if (project.runnerId) {
    runner = await db.get("SELECT id, nome, active FROM rpa_runners WHERE id = ?", project.runnerId);
    if (!runner) throw new HttpError(422, "O servidor de execucao configurado para este RPA nao existe mais. Edite o RPA e escolha outro.");
    if (!runner.active) throw new HttpError(422, `O servidor de execucao ${runner.nome} esta desativado.`);
    if (!isRunnerOnline(runner.id)) {
      throw new HttpError(409, `O servidor ${runner.nome} esta offline: o agente nao se comunica com a plataforma. Verifique se o agente esta rodando no servidor.`);
    }
  } else {
    interpreter = resolveInterpreter(language);
    if (!interpreter) {
      throw new HttpError(422, language === "python"
        ? "Python 3 nao foi encontrado no servidor. Instale o Python ou defina PYTHON_BIN no .env."
        : "Interpretador nao encontrado.");
    }
  }

  const current = getActiveRunForProject(project.id);
  if (current) throw new HttpError(409, "Este RPA ja esta em execucao.", { runId: current.id });
  // O limite vale para o servidor da plataforma; servidores remotos enfileiram no proprio agente.
  const runningCount = [...activeRuns.values()].filter((run) => run.status === "running" && !run.remote).length;
  if (!runner && runningCount >= config.rpa.maxConcurrent) {
    throw new HttpError(429, `Limite de ${config.rpa.maxConcurrent} execucoes simultaneas atingido. Aguarde uma execucao terminar.`);
  }

  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO project_runs (id, projectId, triggeredByUserId, triggerType, triggerValue, language, status, runnerId, runnerName, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    runId, project.id, userId, triggerType, triggerValue || "", language, runner?.id || null, runner?.nome || null, createdAt
  );
  await db.run("UPDATE projects SET lastRunStatus = 'running', lastRunAt = ? WHERE id = ?", createdAt, project.id);

  const state = new RunState({ runId, project, triggerType, triggerValue, userId, runner });
  activeRuns.set(runId, state);

  const starter = runner ? launchRemote(state, project, language) : launch(state, project, language, interpreter);
  starter.catch(async (error) => {
    state.pushEvent({ level: "error", message: `Falha ao iniciar a execucao: ${error.message}` });
    await finalize(state, { exitCode: 1, workDir: null, outputDir: null });
  });

  return state;
}

async function launch(state, project, language, interpreter) {
  const db = await getDb();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "gestao-rpa-"));
  const outputDir = path.join(workDir, "output");
  await fs.mkdir(outputDir, { recursive: true });

  const files = await db.all("SELECT id, fileName, content FROM project_files WHERE projectId = ? ORDER BY createdAt ASC", project.id);
  const filePaths = [];
  for (const file of files) {
    const target = path.join(workDir, sanitizeFileName(file.fileName));
    await fs.writeFile(target, file.content);
    filePaths.push(target);
  }

  const code = String(project.code || "");
  const scriptName = language === "python" ? "user_script.py" : isEsmCode(code) ? "user_script.mjs" : "user_script.js";
  const scriptPath = path.join(workDir, scriptName);
  await fs.writeFile(scriptPath, code, "utf8");
  if (language === "javascript") linkNodeModules(workDir);

  let headless = resolveHeadless(project.browserMode);
  let display = null;
  if (!headless) {
    const check = await ensureDisplay();
    if (check.ok) {
      display = check.display || null;
      if (check.started) state.pushEvent({ level: "info", message: `Display virtual ${check.display} (Xvfb) iniciado para o navegador visivel` });
      if (!check.local) {
        // Servidor sem monitor: o navegador abre na tela virtual, transmitida ao vivo para a plataforma.
        const liveView = await ensureLiveView();
        if (liveView?.error) state.pushEvent({ level: "warn", message: `Transmissao ao vivo indisponivel: ${liveView.error} Exibindo capturas de tela.` });
        else if (liveView) state.setLiveView(liveView);
      }
    } else {
      headless = true;
      state.pushEvent({ level: "warn", message: "Nenhum display grafico (Xvfb) disponivel no servidor. Executando o navegador em modo headless." });
    }
  }
  const args = [...interpreter.prefixArgs, WRAPPERS[language], ...(filePaths[0] ? [filePaths[0]] : [])];
  state.pushEvent({ level: "info", message: `Iniciando ${language === "python" ? "Python" : "Node.js"} (${interpreter.version}) · ${files.length} arquivo(s) de entrada · navegador ${headless ? "headless" : "visivel"}` });

  const child = spawn(interpreter.command, args, {
    cwd: workDir,
    windowsHide: true,
    detached: process.platform !== "win32",
    env: buildEnv({
      RPA_USER_SCRIPT: scriptPath,
      RPA_WORKDIR: workDir,
      RPA_OUTPUT_DIR: outputDir,
      RPA_INPUT_FILE: filePaths[0] || "",
      RPA_FILES: JSON.stringify(filePaths),
      RPA_RUN_ID: state.id,
      RPA_PROJECT_ID: project.id,
      RPA_PROJECT_NAME: project.nome,
      RPA_HEADLESS: headless ? "1" : "0",
      RPA_MODE: "run",
      ...(display && !headless ? { DISPLAY: display } : {})
    })
  });
  state.child = child;

  const timeoutSeconds = resolveTimeout(project);
  const timer = timeoutSeconds ? setTimeout(() => {
    state.timedOut = true;
    state.pushEvent({ level: "error", message: timeoutMessage(timeoutSeconds) });
    killTree(child);
  }, timeoutSeconds * 1000) : null;

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop();
    for (const line of lines) handleStdoutLine(state, line);
  });

  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    state.stderr = truncate(state.stderr + text, MAX_STDERR_CHARS);
    stderrBuffer += text;
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop();
    for (const line of lines) handleStderrLine(state, line);
  });

  await new Promise((resolve) => {
    child.on("error", (error) => {
      state.pushEvent({ level: "error", message: `Erro no processo: ${error.message}` });
      resolve({ exitCode: 1 });
    });
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) handleStdoutLine(state, stdoutBuffer);
      if (stderrBuffer.trim()) state.pushEvent({ level: "warn", message: stderrBuffer.trim() });
      resolve({ exitCode: code });
    });
  }).then(async ({ exitCode }) => {
    clearTimeout(timer);
    await finalize(state, { exitCode, workDir, outputDir });
  });
}

// ─── Execucao remota (agente instalado em outro servidor) ─────────────────────
async function launchRemote(state, project, language) {
  const db = await getDb();
  const files = await db.all("SELECT fileName, content FROM project_files WHERE projectId = ? ORDER BY createdAt ASC", project.id);
  const code = String(project.code || "");
  const headless = resolveHeadless(project.browserMode, { remote: true });
  const timeoutSeconds = resolveTimeout(project);

  const payload = {
    runId: state.id,
    projectId: project.id,
    projectName: project.nome,
    language,
    scriptName: language === "python" ? "user_script.py" : isEsmCode(code) ? "user_script.mjs" : "user_script.js",
    code,
    headless,
    // Agentes antigos (<= 1.1) aplicam timeoutSeconds + 60 como trava local: "sem limite" vira 7 dias para eles.
    timeoutSeconds: timeoutSeconds || 7 * 24 * 3600,
    noTimeout: !timeoutSeconds,
    // O wrapper vai junto com o job: o agente sempre usa a mesma versao da plataforma.
    wrapperName: path.basename(WRAPPERS[language]),
    wrapper: await fs.readFile(WRAPPERS[language], "utf8"),
    files: files.map((file) => ({ name: sanitizeFileName(file.fileName), content: Buffer.from(file.content).toString("base64") }))
  };

  state.pushEvent({ level: "info", message: `Enviando para o servidor ${state.runnerName} · ${files.length} arquivo(s) de entrada · navegador ${headless ? "headless" : "visivel na area de trabalho do servidor"}` });
  state.pushEvent({ level: "info", message: "Aguardando o agente do servidor receber a execucao..." });

  const remote = state.remote;
  if (timeoutSeconds) {
    remote.timers.push(setTimeout(() => {
      state.timedOut = true;
      state.pushEvent({ level: "error", message: timeoutMessage(timeoutSeconds) });
      requestRemoteCancel(state);
    }, timeoutSeconds * 1000));
  }

  // Vigia: agente que parou de responder (desligado, sem rede) nao pode prender a execucao para sempre.
  const watchdog = () => {
    if (state.status !== "running") return;
    const silentFor = Date.now() - remote.lastContactAt;
    const cancelExpired = remote.cancelRequestedAt && Date.now() - remote.cancelRequestedAt > REMOTE_CANCEL_GRACE_MS;
    if ((remote.picked && silentFor > REMOTE_SILENCE_MS) || cancelExpired) {
      if (!cancelExpired) state.pushEvent({ level: "error", message: `O agente do servidor ${state.runnerName} parou de responder ha ${Math.round(silentFor / 1000)}s.` });
      finalize(state, { exitCode: null, workDir: null, outputDir: null });
      return;
    }
    remote.timers.push(setTimeout(watchdog, 10_000));
  };
  remote.timers.push(setTimeout(watchdog, 10_000));

  enqueueJob(state.runnerId, { state, payload });
}

async function requestRemoteCancel(state) {
  const remote = state.remote;
  if (!remote || state.status !== "running") return;
  if (dequeueJob(state.runnerId, state.id)) {
    // Ainda nao tinha sido entregue ao agente: encerra direto.
    await finalize(state, { exitCode: null, workDir: null, outputDir: null });
    return;
  }
  remote.cancelRequestedAt ||= Date.now();
}

/** O agente retirou o job da fila. */
export function markRemotePicked(state, agentInfo = {}) {
  state.remote.picked = true;
  state.remote.lastContactAt = Date.now();
  state.pushEvent({ level: "info", message: `Agente ${state.runnerName} iniciou a execucao${agentInfo.hostname ? ` em ${agentInfo.hostname}` : ""}.` });
}

/** Linhas de stdout/stderr enviadas pelo agente. Retorna se o agente deve encerrar o processo. */
export function receiveRemoteOutput(state, { stdout = [], stderr = [] } = {}) {
  state.remote.lastContactAt = Date.now();
  for (const line of stdout.slice(0, 5000)) handleStdoutLine(state, String(line));
  for (const line of stderr.slice(0, 5000)) {
    state.stderr = truncate(state.stderr + line + "\n", MAX_STDERR_CHARS);
    handleStderrLine(state, String(line));
  }
  return { cancel: Boolean(state.remote.cancelRequestedAt) };
}

export function receiveRemoteArtifact(state, name, content) {
  const remote = state.remote;
  remote.lastContactAt = Date.now();
  if (remote.artifacts.length >= MAX_ARTIFACTS) throw new HttpError(413, `Limite de ${MAX_ARTIFACTS} arquivos de saida por execucao.`);
  if (remote.artifactBytes + content.length > MAX_ARTIFACTS_BYTES) {
    state.pushEvent({ level: "warn", message: `Arquivo de saida ${name} ignorado (limite de 50 MB por execucao).` });
    throw new HttpError(413, "Limite de 50 MB de arquivos de saida excedido.");
  }
  remote.artifacts.push({ name: sanitizeFileName(name), content });
  remote.artifactBytes += content.length;
}

export async function finishRemoteRun(state, exitCode) {
  await finalize(state, { exitCode: Number.isInteger(exitCode) ? exitCode : 1, workDir: null, outputDir: null });
}

function handleStderrLine(state, line) {
  const trimmed = line.trim();
  if (!trimmed || (trimmed.startsWith("WARNING:") && trimmed.includes("pip"))) return;
  state.pushEvent({ level: /error|traceback|exception/i.test(trimmed) ? "error" : "warn", message: trimmed });
}

function handleStdoutLine(state, line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.level) {
        state.pushEvent(parsed);
        return;
      }
    } catch { /* texto comum */ }
  }
  state.pushEvent({ level: "info", message: trimmed });
}

async function saveArtifacts(state, items) {
  const db = await getDb();
  const saved = [];
  for (const { name, content } of items) {
    const id = crypto.randomUUID();
    const mimeType = guessMimeType(name);
    await db.run(
      "INSERT INTO project_run_artifacts (id, runId, projectId, fileName, mimeType, fileSize, content, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, state.id, state.projectId, name, mimeType, content.length, content, new Date().toISOString()
    );
    saved.push({ id, fileName: name, mimeType, fileSize: content.length });
  }
  return saved;
}

async function collectArtifacts(state, outputDir) {
  if (state.remote) return saveArtifacts(state, state.remote.artifacts);
  if (!outputDir) return [];
  const items = [];
  let totalBytes = 0;
  let entries = [];
  try {
    entries = await fs.readdir(outputDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries.filter((item) => item.isFile()).slice(0, MAX_ARTIFACTS)) {
    const fullPath = path.join(outputDir, entry.name);
    const stat = await fs.stat(fullPath);
    if (totalBytes + stat.size > MAX_ARTIFACTS_BYTES) {
      state.pushEvent({ level: "warn", message: `Arquivo de saida ${entry.name} ignorado (limite de 50 MB por execucao).` });
      continue;
    }
    items.push({ name: entry.name, content: await fs.readFile(fullPath) });
    totalBytes += stat.size;
  }
  return saveArtifacts(state, items);
}

async function finalize(state, { exitCode, workDir, outputDir }) {
  if (state.status !== "running") return;
  for (const timer of state.remote?.timers || []) clearTimeout(timer);
  const db = await getDb();
  const finishedAt = new Date();
  const status = state.cancelledBy ? "cancelled" : state.timedOut ? "timeout" : exitCode === 0 ? "success" : "error";
  state.status = status;

  let artifacts = [];
  try {
    artifacts = await collectArtifacts(state, outputDir);
  } catch (error) {
    state.pushEvent({ level: "warn", message: `Falha ao coletar arquivos de saida: ${error.message}` });
  }
  if (state.droppedEvents) state.events.push({ ts: finishedAt.toISOString(), level: "warn", message: `${state.droppedEvents} linha(s) de log omitidas (limite de ${MAX_EVENTS}).` });

  const lastError = [...state.events].reverse().find((event) => event.level === "error");
  const errorMessage = status === "success" ? "" : status === "cancelled" ? "Execucao cancelada pelo usuario."
    : status === "timeout" ? "Tempo limite excedido." : (lastError?.message || state.stderr.split("\n").filter(Boolean).at(-1) || `Processo finalizado com codigo ${exitCode}.`);
  const durationMs = finishedAt - state.startedAt;
  const summary = status === "success" ? summarizeMessages(state.events) || "Execucao concluida com sucesso." : truncate(errorMessage, 500);

  await db.run(
    `UPDATE project_runs SET status = ?, exitCode = ?, durationMs = ?, stdout = ?, stderr = ?, errorMessage = ?, events = ?, lastScreenshot = ?,
       cancelledByUserId = ?, finishedAt = ? WHERE id = ?`,
    status, Number.isInteger(exitCode) ? exitCode : null, durationMs, truncate(state.stdoutLines.join("\n"), MAX_STDOUT_CHARS),
    state.stderr, truncate(errorMessage, 4000), JSON.stringify(state.events), state.lastScreenshot?.image || null,
    state.cancelledBy, finishedAt.toISOString(), state.id
  );
  await db.run(
    "UPDATE projects SET lastRunStatus = ?, lastRunAt = ?, lastRunOutput = ? WHERE id = ?",
    status, finishedAt.toISOString(), summary, state.projectId
  );

  const project = await db.get("SELECT responsibleUserId FROM projects WHERE id = ?", state.projectId);
  const triggerLabel = state.triggerType === "schedule" ? "Execucao agendada" : "Execucao";
  await notifyManagers({
    kind: status === "success" ? "rpa_success" : "rpa_failure",
    title: `${triggerLabel} ${RUN_STATUS_LABELS[status].toLowerCase()}: ${state.projectName}`,
    body: summary,
    targetType: "project",
    targetId: state.projectId,
    metadata: { runId: state.id, status, triggerType: state.triggerType, durationMs }
  }, project?.responsibleUserId ? [project.responsibleUserId] : []);

  state.finishedRun = { id: state.id, status, exitCode, durationMs, errorMessage, finishedAt: finishedAt.toISOString(), artifacts };
  state.broadcast("done", state.finishedRun);
  state.listeners.clear();
  setTimeout(() => activeRuns.delete(state.id), KEEP_FINISHED_MS).unref();

  if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}

export async function cancelRun(runId, userId) {
  const state = activeRuns.get(runId);
  if (!state || state.status !== "running") throw new HttpError(409, "Esta execucao nao esta em andamento.");
  state.cancelledBy = userId;
  state.pushEvent({ level: "warn", message: "Cancelamento solicitado. Encerrando processos..." });
  if (state.remote) await requestRemoteCancel(state);
  else killTree(state.child);
  return state;
}

/** Na inicializacao: execucoes que ficaram "running" (servidor reiniciado) viram "interrupted". */
export async function recoverInterruptedRuns() {
  const db = await getDb();
  const now = new Date().toISOString();
  const rows = await db.all("SELECT id, projectId FROM project_runs WHERE status = 'running'");
  for (const row of rows) {
    await db.run("UPDATE project_runs SET status = 'interrupted', errorMessage = 'Servidor reiniciado durante a execucao.', finishedAt = ? WHERE id = ?", now, row.id);
    await db.run("UPDATE projects SET lastRunStatus = 'interrupted' WHERE id = ? AND lastRunStatus = 'running'", row.projectId);
  }
}

export function stopAllRuns() {
  for (const state of activeRuns.values()) {
    if (state.status === "running") killTree(state.child);
  }
}

// ─── Validacao de codigo ──────────────────────────────────────────────────────
const PYTHON_CHECK = `
import ast, sys, json, importlib.util
source = open(sys.argv[1], encoding="utf-8").read()
try:
    tree = ast.parse(source, filename="script.py")
except SyntaxError as error:
    print(json.dumps({"ok": False, "line": error.lineno, "column": error.offset, "message": error.msg, "text": (error.text or "").strip()}))
    sys.exit(0)
missing = []
for node in ast.walk(tree):
    names = []
    if isinstance(node, ast.Import):
        names = [alias.name.split(".")[0] for alias in node.names]
    elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
        names = [node.module.split(".")[0]]
    for name in names:
        if name not in missing and importlib.util.find_spec(name) is None:
            missing.append(name)
print(json.dumps({"ok": True, "missing": missing}))
`;

function runCheck(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 30000, ...options });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "", error: result.error };
}

export async function validateCode(languageInput, code) {
  const language = normalizeLanguage(languageInput);
  if (!language) throw new HttpError(400, "Linguagem invalida.");
  if (!String(code || "").trim()) throw new HttpError(400, "Informe o codigo para validar.");
  const interpreter = resolveInterpreter(language);
  if (!interpreter) throw new HttpError(422, "Python 3 nao foi encontrado no servidor. Instale o Python ou defina PYTHON_BIN.");

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "gestao-rpa-check-"));
  try {
    if (language === "python") {
      const file = path.join(workDir, "script.py");
      await fs.writeFile(file, code, "utf8");
      const result = runCheck(interpreter.command, [...interpreter.prefixArgs, "-c", PYTHON_CHECK, file], { env: buildEnv({}) });
      const parsed = (() => { try { return JSON.parse(result.stdout.trim().split("\n").at(-1)); } catch { return null; } })();
      if (!parsed) return { ok: false, message: `Falha ao validar: ${(result.stderr || result.error?.message || "erro desconhecido").trim()}` };
      if (!parsed.ok) {
        return { ok: false, line: parsed.line, column: parsed.column, message: `Erro de sintaxe na linha ${parsed.line}: ${parsed.message}`, details: parsed.text };
      }
      const warnings = parsed.missing.length ? [`Modulo(s) nao instalado(s) no servidor: ${parsed.missing.join(", ")}`] : [];
      return { ok: true, message: "Sintaxe valida.", warnings };
    }

    const esm = isEsmCode(code);
    const file = path.join(workDir, esm ? "script.mjs" : "script.js");
    await fs.writeFile(file, code, "utf8");
    const result = runCheck(interpreter.command, ["--check", file]);
    if (result.status !== 0) {
      const lineMatch = result.stderr.match(/script\.m?js:(\d+)/);
      const messageLine = result.stderr.split("\n").find((line) => /Error:/.test(line)) || result.stderr.trim().split("\n").at(-1);
      const line = lineMatch ? Number(lineMatch[1]) : null;
      return { ok: false, line, message: `Erro de sintaxe${line ? ` na linha ${line}` : ""}: ${messageLine?.trim() || "codigo invalido"}` };
    }
    const warnings = [];
    const required = [...code.matchAll(/require\(\s*["']([^"'./][^"']*)["']\s*\)|from\s+["']([^"'./][^"']*)["']/g)].map((match) => match[1] || match[2]);
    const missing = [...new Set(required.map((name) => name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]))]
      .filter((name) => !name.startsWith("node:"))
      .filter((name) => {
        try {
          import.meta.resolve(name);
          return false;
        } catch {
          return !["fs", "path", "os", "child_process", "crypto", "util", "http", "https", "url", "events", "stream", "zlib", "readline", "assert", "buffer", "timers"].includes(name);
        }
      });
    if (missing.length) warnings.push(`Pacote(s) nao instalado(s) no servidor: ${missing.join(", ")}`);
    if (esm) warnings.push("Codigo em ES Modules: as capturas automaticas de tela do Playwright so funcionam com require().");
    return { ok: true, message: "Sintaxe valida.", warnings };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
