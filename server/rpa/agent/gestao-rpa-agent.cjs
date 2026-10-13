#!/usr/bin/env node
/*
 * Agente de execucao de RPA — Gestao de Sistemas Unimed.
 *
 * Roda no servidor de execucao (ex.: Windows acessado por RDP), na sessao do usuario logado,
 * para que o navegador do robo abra VISIVEL na area de trabalho. Nao recebe conexoes: consulta
 * a plataforma por HTTP (long polling), executa o job e devolve logs, capturas e arquivos.
 *
 * Requisitos: Node.js 18+ (e Python 3 + playwright para robos Python).
 *
 * Uso:
 *   node gestao-rpa-agent.cjs install --server http://192.168.177.77:5174 --token rpa_xxx [--python "C:\\Python312\\python.exe"]
 *   node gestao-rpa-agent.cjs run         (inicia o agente — o install ja configura o inicio automatico no logon)
 *   node gestao-rpa-agent.cjs test        (testa a conexao com a plataforma)
 *   node gestao-rpa-agent.cjs uninstall   (remove o inicio automatico)
 */
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");

const VERSION = "1.2.0";
const AGENT_DIR = __dirname;
const CONFIG_FILE = path.join(AGENT_DIR, "agent.config.json");
const LOG_FILE = path.join(AGENT_DIR, "agent.log");
const LOCK_FILE = path.join(AGENT_DIR, "agent.lock");
const STARTUP_NAME = "GestaoRPA-Agente.cmd";
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const FLUSH_MS = 700;
// Mesmo sem saida do script, o agente consulta a plataforma a cada 2s (cancelamento rapido).
const KEEPALIVE_MS = 2 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const MAX_OUTPUT_FILES = 20;
const SCREENSHOT_RE = /"level":\s*"screenshot"/;

// ─── Utilitarios ──────────────────────────────────────────────────────────────
function log(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch { /* log em arquivo e opcional */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Configuracao nao encontrada (${CONFIG_FILE}). Rode: node ${path.basename(__filename)} install --server <url> --token <token>`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  if (!config.server || !config.token) throw new Error("agent.config.json precisa de 'server' e 'token'.");
  config.server = String(config.server).replace(/\/+$/, "");
  return config;
}

// ─── Ambiente local ───────────────────────────────────────────────────────────
let pythonCache;
function resolvePython(config) {
  if (pythonCache !== undefined) return pythonCache;
  const candidates = config.pythonBin
    ? [[config.pythonBin, []]]
    : process.platform === "win32" ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  for (const [command, prefixArgs] of candidates) {
    const probe = spawnSync(command, [...prefixArgs, "--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    const version = `${probe.stdout || ""}${probe.stderr || ""}`.trim();
    if (probe.status === 0 && /Python 3\./.test(version)) {
      pythonCache = { command, prefixArgs, version };
      return pythonCache;
    }
  }
  pythonCache = null;
  return null;
}

let screenSupportCache = null;
/** Pillow instalado = tela ao vivo disponivel (verificado a cada 10 min, pode ser instalado depois). */
function hasScreenSupport(config) {
  if (screenSupportCache && Date.now() - screenSupportCache.at < 10 * 60 * 1000) return screenSupportCache.value;
  const python = resolvePython(config);
  const probe = python ? spawnSync(python.command, [...python.prefixArgs, "-c", "import PIL"], { windowsHide: true, timeout: 15000 }) : null;
  screenSupportCache = { value: probe?.status === 0, at: Date.now() };
  return screenSupportCache.value;
}

function hasNodePlaywright() {
  try {
    require.resolve("playwright", { paths: [AGENT_DIR] });
    return true;
  } catch {
    return false;
  }
}

function machineInfo(config, runningJobs = 0) {
  const python = resolvePython(config);
  let username = "";
  try { username = os.userInfo().username; } catch { /* sem usuario */ }
  return {
    hostname: os.hostname(),
    username: process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username,
    platform: `${process.platform} ${os.release()}`,
    node: process.version,
    python: python ? python.version : "",
    playwrightNode: hasNodePlaywright(),
    screenCapture: hasScreenSupport(config),
    version: VERSION,
    runningJobs
  };
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
async function request(config, method, urlPath, { json, body, headers = {}, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.server}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

function errorText(response) {
  return (response.data && typeof response.data === "object" && response.data.error) || `HTTP ${response.status}`;
}

// ─── Execucao de um job ───────────────────────────────────────────────────────
function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
}

async function runJob(config, job) {
  log("info", `Job recebido: ${job.projectName} (${job.language}) · execucao ${job.runId}`);
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gestao-rpa-"));
  const outputDir = path.join(workDir, "output");
  await fsp.mkdir(outputDir, { recursive: true });

  const stdoutQueue = [];
  const stderrQueue = [];
  let lastPostAt = Date.now();
  let cancelled = false;
  let child = null;
  let flushing = false;

  async function flush(force = false) {
    if (flushing) return;
    if (!force && !stdoutQueue.length && !stderrQueue.length && Date.now() - lastPostAt < KEEPALIVE_MS) return;
    flushing = true;
    // Capturas de tela sao frequentes e pesadas: envia so a mais recente de cada lote.
    const lines = stdoutQueue.splice(0);
    let lastShot = -1;
    lines.forEach((line, index) => { if (SCREENSHOT_RE.test(line)) lastShot = index; });
    const stdout = lines.filter((line, index) => !SCREENSHOT_RE.test(line) || index === lastShot);
    const stderr = stderrQueue.splice(0);
    try {
      const response = await request(config, "POST", `/api/agent/runs/${job.runId}/output`, { json: { stdout, stderr } });
      lastPostAt = Date.now();
      if (response.status === 410 || response.data?.cancel) {
        if (!cancelled) log("warn", "Execucao cancelada/encerrada pela plataforma. Finalizando o processo.");
        cancelled = true;
        killTree(child);
      }
    } catch (error) {
      // Sem rede: devolve as linhas para a fila e tenta no proximo ciclo.
      stdoutQueue.unshift(...stdout);
      stderrQueue.unshift(...stderr);
      log("warn", `Falha ao enviar logs: ${error.message}`);
    } finally {
      flushing = false;
    }
  }

  const pushLines = (queue) => {
    let buffer = "";
    return {
      write(chunk) {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (const line of lines) if (line.trim()) queue.push(line);
      },
      end() {
        if (buffer.trim()) queue.push(buffer);
        buffer = "";
      }
    };
  };

  let exitCode = 1;
  try {
    const filePaths = [];
    for (const file of job.files || []) {
      const target = path.join(workDir, path.basename(file.name));
      await fsp.writeFile(target, Buffer.from(file.content, "base64"));
      filePaths.push(target);
    }
    const scriptPath = path.join(workDir, job.scriptName);
    await fsp.writeFile(scriptPath, job.code, "utf8");
    const wrapperPath = path.join(workDir, job.wrapperName);
    await fsp.writeFile(wrapperPath, job.wrapper, "utf8");

    let command;
    let prefixArgs = [];
    if (job.language === "python") {
      const python = resolvePython(config);
      if (!python) throw new Error("Python 3 nao encontrado neste servidor. Instale o Python ou informe --python no install.");
      command = python.command;
      prefixArgs = python.prefixArgs;
      stdoutQueue.push(JSON.stringify({ level: "info", message: `Iniciando ${python.version} em ${os.hostname()} · navegador ${job.headless ? "headless" : "visivel na area de trabalho"}` }));
    } else {
      command = process.execPath;
      stdoutQueue.push(JSON.stringify({ level: "info", message: `Iniciando Node ${process.version} em ${os.hostname()} · navegador ${job.headless ? "headless" : "visivel na area de trabalho"}` }));
      if (!hasNodePlaywright()) stdoutQueue.push(JSON.stringify({ level: "warn", message: `Pacote "playwright" nao instalado na pasta do agente (${AGENT_DIR}). Rode "npm install playwright" nela.` }));
    }

    const stdout = pushLines(stdoutQueue);
    const stderr = pushLines(stderrQueue);
    child = spawn(command, [...prefixArgs, wrapperPath, ...(filePaths[0] ? [filePaths[0]] : [])], {
      cwd: workDir,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NODE_PATH: path.join(AGENT_DIR, "node_modules"),
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        RPA_USER_SCRIPT: scriptPath,
        RPA_WORKDIR: workDir,
        RPA_OUTPUT_DIR: outputDir,
        RPA_INPUT_FILE: filePaths[0] || "",
        RPA_FILES: JSON.stringify(filePaths),
        RPA_RUN_ID: job.runId,
        RPA_PROJECT_ID: job.projectId,
        RPA_PROJECT_NAME: job.projectName,
        RPA_HEADLESS: job.headless ? "1" : "0",
        RPA_MODE: "run"
      }
    });

    const flusher = setInterval(() => { flush(); }, FLUSH_MS);
    // Rede de seguranca caso a plataforma fique inacessivel durante a execucao (RPA "sem limite" nao tem).
    const safety = job.noTimeout ? null : setTimeout(() => {
      stderrQueue.push(`Tempo limite local (${job.timeoutSeconds + 60}s) atingido no agente.`);
      killTree(child);
    }, (Number(job.timeoutSeconds) + 60) * 1000);

    exitCode = await new Promise((resolve) => {
      child.stdout.on("data", (chunk) => stdout.write(chunk));
      child.stderr.on("data", (chunk) => stderr.write(chunk));
      child.on("error", (error) => {
        stderrQueue.push(`Erro ao iniciar o processo: ${error.message}`);
        resolve(1);
      });
      child.on("close", (code) => {
        stdout.end();
        stderr.end();
        resolve(code === null ? 1 : code);
      });
    });
    clearInterval(flusher);
    clearTimeout(safety);
  } catch (error) {
    stderrQueue.push(`Erro no agente: ${error.message}`);
    exitCode = 1;
  }

  await flush(true);

  if (!cancelled) {
    let entries = [];
    try { entries = (await fsp.readdir(outputDir, { withFileTypes: true })).filter((item) => item.isFile()).slice(0, MAX_OUTPUT_FILES); } catch { /* sem saida */ }
    for (const entry of entries) {
      try {
        const content = await fsp.readFile(path.join(outputDir, entry.name));
        const response = await request(config, "POST", `/api/agent/runs/${job.runId}/artifacts`, {
          body: content,
          headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(entry.name) },
          timeoutMs: 120000
        });
        if (!response.ok) log("warn", `Arquivo ${entry.name} recusado: ${errorText(response)}`);
      } catch (error) {
        log("warn", `Falha ao enviar ${entry.name}: ${error.message}`);
      }
    }
  }

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await request(config, "POST", `/api/agent/runs/${job.runId}/finish`, { json: { exitCode } });
      if (response.ok || response.status === 410) break;
    } catch (error) {
      log("warn", `Falha ao finalizar (tentativa ${attempt}): ${error.message}`);
    }
    await sleep(attempt * 2000);
  }
  log("info", `Job ${job.runId} finalizado com codigo ${exitCode}${cancelled ? " (cancelado)" : ""}.`);
  await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
}

// ─── Tela ao vivo ─────────────────────────────────────────────────────────────
// Captura a area de trabalho SO enquanto alguem assiste na plataforma. A sessao precisa estar
// ativa: conectada por RDP ou enviada ao console com tscon (sessao so "desconectada" nao tem tela).
const SCREEN_SCRIPT = path.join(AGENT_DIR, "screen-capture.py");
const SCREEN_INTERVAL_MS = 400;
const SCREEN_RESEND_MS = 5000;
const SCREEN_MAX_WIDTH = 1600;
const SCREEN_QUALITY = 60;

function createCapturer(python) {
  const child = spawn(python.command, [...python.prefixArgs, "-u", SCREEN_SCRIPT, String(SCREEN_MAX_WIDTH), String(SCREEN_QUALITY)], { windowsHide: true, cwd: AGENT_DIR });
  let buffer = Buffer.alloc(0);
  let pending = null;
  let dead = false;
  let stderr = "";

  const settle = (result) => {
    const current = pending;
    pending = null;
    current?.(result);
  };
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  child.on("error", (error) => { dead = true; settle({ ok: false, message: `Falha ao iniciar a captura: ${error.message}` }); });
  child.on("close", () => {
    dead = true;
    settle({ ok: false, message: `Processo de captura encerrou. ${stderr.trim().split("\n").at(-1) || ""}`.trim() });
  });
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (pending) {
      const newline = buffer.indexOf(10);
      if (newline === -1) return;
      const header = buffer.subarray(0, newline).toString("utf8").trim();
      if (header.startsWith("OK ")) {
        const [, size, width, height] = header.split(" ");
        const end = newline + 1 + Number(size);
        if (buffer.length < end) return;
        const data = buffer.subarray(newline + 1, end);
        buffer = buffer.subarray(end);
        settle({ ok: true, data, width: Number(width), height: Number(height) });
      } else {
        buffer = buffer.subarray(newline + 1);
        if (header.startsWith("ERR")) settle({ ok: false, message: header.slice(4) });
      }
    }
  });

  return {
    get dead() { return dead; },
    capture() {
      if (dead) return Promise.resolve({ ok: false, message: "Processo de captura indisponivel." });
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle({ ok: false, message: "Captura demorou mais de 15s." }), 15000);
        pending = (result) => { clearTimeout(timer); resolve(result); };
        child.stdin.write("cap\n");
      });
    },
    stop() {
      if (dead) return;
      try { child.stdin.end("quit\n"); } catch { /* ja encerrado */ }
      setTimeout(() => { if (!dead) child.kill(); }, 2000).unref();
    }
  };
}

async function updateScreenScript(config) {
  try {
    const response = await fetch(`${config.server}/api/agent/screen-script`, { headers: { Authorization: `Bearer ${config.token}` } });
    if (response.ok) await fsp.writeFile(SCREEN_SCRIPT, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    log("warn", `Nao foi possivel atualizar o script de captura: ${error.message}`);
  }
}

function sessionHint(message) {
  return `${message} — a sessao do servidor precisa estar ativa: conectada por RDP ou enviada ao console (tscon) ao desconectar.`;
}

async function screenLoop(config) {
  await updateScreenScript(config);
  let capturer = null;
  let lastHash = "";
  let lastSentAt = 0;
  let lastError = "";
  const stopCapturer = () => {
    capturer?.stop();
    capturer = null;
  };

  for (;;) {
    try {
      const demand = await request(config, "GET", "/api/agent/screen/demand", { timeoutMs: 45000 });
      if (!demand.ok) {
        stopCapturer();
        await sleep(10000);
        continue;
      }
      if (!demand.data?.watching) {
        stopCapturer();
        continue;
      }

      const python = resolvePython(config);
      if (!python || !fs.existsSync(SCREEN_SCRIPT)) {
        await request(config, "POST", "/api/agent/screen/status", { json: { available: false, message: python ? "Script de captura nao encontrado no agente." : "Python 3 nao encontrado no servidor (necessario para a tela ao vivo)." } });
        await sleep(10000);
        continue;
      }
      log("info", "Transmitindo a tela para a plataforma.");
      lastHash = "";
      lastError = "";
      let watching = true;
      while (watching) {
        const startedAt = Date.now();
        if (!capturer || capturer.dead) capturer = createCapturer(python);
        const shot = await capturer.capture();
        let response = null;
        if (shot.ok) {
          lastError = "";
          const hash = crypto.createHash("md5").update(shot.data).digest("hex");
          // Tela parada: nao reenvia o mesmo quadro, so confirma de tempos em tempos se ainda ha espectador.
          if (hash !== lastHash || Date.now() - lastSentAt > SCREEN_RESEND_MS) {
            response = await request(config, "POST", "/api/agent/screen/frame", {
              body: shot.data,
              headers: { "Content-Type": "image/jpeg", "X-Screen-Width": String(shot.width), "X-Screen-Height": String(shot.height) },
              timeoutMs: 15000
            });
            lastHash = hash;
            lastSentAt = Date.now();
          }
        } else {
          const message = sessionHint(`Tela indisponivel (${shot.message || "erro na captura"})`);
          if (message !== lastError || Date.now() - lastSentAt > SCREEN_RESEND_MS) {
            response = await request(config, "POST", "/api/agent/screen/status", { json: { available: false, message } });
            lastError = message;
            lastSentAt = Date.now();
          }
          await sleep(2000);
        }
        if (response) watching = response.ok && response.data?.watching !== false;
        await sleep(Math.max(0, SCREEN_INTERVAL_MS - (Date.now() - startedAt)));
      }
      log("info", "Transmissao de tela encerrada (ninguem assistindo).");
      stopCapturer();
    } catch (error) {
      stopCapturer();
      log("warn", `Tela ao vivo: ${error.message}`);
      await sleep(5000);
    }
  }
}

// ─── Loop principal ───────────────────────────────────────────────────────────
function acquireLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, "utf8"));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        log("warn", `Outro agente ja esta rodando (pid ${pid}). Encerrando esta instancia.`);
        process.exit(0);
      } catch { /* processo antigo morreu */ }
    }
  } catch { /* sem lock */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => { try { if (Number(fs.readFileSync(LOCK_FILE, "utf8")) === process.pid) fs.unlinkSync(LOCK_FILE); } catch { /* ok */ } };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
}

async function heartbeat(config, runningJobs) {
  const response = await request(config, "POST", "/api/agent/heartbeat", { json: machineInfo(config, runningJobs) });
  if (!response.ok) throw new Error(errorText(response));
  return response.data;
}

async function runAgent() {
  const config = readConfig();
  acquireLock();
  if (process.platform === "win32") process.title = "Gestao RPA - Agente";
  log("info", `Agente ${VERSION} iniciado em ${os.hostname()} · plataforma ${config.server}`);

  let running = 0;
  const beat = async () => {
    try {
      const data = await heartbeat(config, running);
      if (data?.latestVersion && data.latestVersion !== VERSION) log("warn", `Nova versao do agente disponivel (${data.latestVersion}). Baixe em ${config.server}/api/agent/download`);
    } catch (error) {
      log("warn", `Heartbeat falhou: ${error.message}`);
    }
  };
  await beat();
  setInterval(beat, HEARTBEAT_MS);
  // Tela ao vivo roda em paralelo aos jobs (inclusive durante uma execucao).
  screenLoop(config);

  let backoff = 2000;
  for (;;) {
    try {
      const response = await request(config, "GET", `/api/agent/jobs/next?hostname=${encodeURIComponent(os.hostname())}`, { timeoutMs: 45000 });
      if (response.status === 204) {
        backoff = 2000;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        log("error", `Acesso negado pela plataforma: ${errorText(response)}`);
        await sleep(60000);
        continue;
      }
      if (!response.ok) throw new Error(errorText(response));
      backoff = 2000;
      running += 1;
      try {
        await runJob(config, response.data);
      } finally {
        running -= 1;
      }
    } catch (error) {
      log("warn", `Sem comunicacao com a plataforma: ${error.message}. Nova tentativa em ${Math.round(backoff / 1000)}s.`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

// ─── Instalacao (inicio automatico no logon do usuario) ───────────────────────
function startupFile() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", STARTUP_NAME);
}

async function install(args) {
  const server = String(args.server || "").replace(/\/+$/, "");
  // Tolera token colado com <>, aspas ou espacos.
  const token = String(args.token || "").trim().replace(/^[<"']+|[>"']+$/g, "");
  if (!server || !token) throw new Error("Informe --server e --token. Ex.: install --server http://192.168.177.77:5174 --token rpa_xxx");
  const config = { server, token, ...(args.python ? { pythonBin: String(args.python) } : {}) };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  log("info", `Configuracao salva em ${CONFIG_FILE}`);

  const data = await heartbeat({ ...config }, 0);
  log("info", `Conectado a plataforma como servidor "${data?.runner}".`);
  const python = resolvePython(config);
  log(python ? "info" : "warn", python ? `Python encontrado: ${python.version}` : "Python 3 nao encontrado (necessario para robos Python).");
  if (!hasNodePlaywright()) log("warn", `Para robos JavaScript, rode "npm install playwright" em ${AGENT_DIR}.`);

  if (process.platform !== "win32") {
    log("info", "Fora do Windows: configure o inicio automatico (systemd, etc.) chamando 'node gestao-rpa-agent.cjs run'.");
    return;
  }
  // Pasta Inicializar do usuario: o agente sobe a cada logon, NA SESSAO do usuario (navegador visivel).
  const target = startupFile();
  const script = `@echo off\r\ncd /d "${AGENT_DIR}"\r\nstart "Gestao RPA - Agente" /min "${process.execPath}" "${__filename}" run\r\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, script);
  log("info", `Inicio automatico configurado: ${target}`);
  spawn("cmd.exe", ["/c", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  log("info", "Agente iniciado em uma janela minimizada. Instalacao concluida.");
}

function uninstall() {
  const target = startupFile();
  if (fs.existsSync(target)) fs.unlinkSync(target);
  log("info", "Inicio automatico removido. Feche a janela 'Gestao RPA - Agente' para parar o agente atual.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "run";
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) throw new Error(`Node.js 18+ e necessario (versao atual ${process.version}).`);
  if (command === "install") return install(args);
  if (command === "uninstall") return uninstall();
  if (command === "test") {
    const config = readConfig();
    const data = await heartbeat(config, 0);
    log("info", `OK: conectado como servidor "${data?.runner}".`);
    return undefined;
  }
  if (command === "run") return runAgent();
  throw new Error(`Comando desconhecido: ${command}. Use install, run, test ou uninstall.`);
}

main().catch((error) => {
  log("error", error.message);
  process.exit(1);
});
