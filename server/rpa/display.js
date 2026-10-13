// Display virtual do servidor Linux (Xvfb) e transmissao ao vivo dele (x11vnc + noVNC).
// O RPA roda no servidor: o navegador "visivel" abre na tela virtual do Xvfb, e quem
// acompanha pela plataforma ve essa tela via noVNC (somente visualizacao).
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { config } from "../config.js";

const DISPLAY = process.env.DISPLAY || ":99";
const SCREEN_WIDTH = 1366;
const SCREEN_HEIGHT = 900;
const VNC_PORT = 5900;
const NOVNC_WEB_DIR = "/usr/share/novnc";

let displayCheck = null;
let liveViewCheck = null;

function displayNumber(display) {
  const match = /^:(\d+)(\.\d+)?$/.exec(display || "");
  return match ? match[1] : null;
}

function hasCommand(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// DISPLAY definido nao garante X server de pe (Xvfb pode ter morrido, ou nao subido por
// causa de um /tmp/.X99-lock antigo apos restart do container).
function isLocalDisplayAlive(number) {
  const lockFile = `/tmp/.X${number}-lock`;
  if (!existsSync(`/tmp/.X11-unix/X${number}`) || !existsSync(lockFile)) return false;
  try {
    const pid = Number(readFileSync(lockFile, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && isPidAlive(pid);
  } catch {
    return false;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitFor(check, attempts = 50, intervalMs = 100) {
  for (let i = 0; i < attempts; i += 1) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function spawnDaemon(command, args) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", (error) => console.warn(`[display] Falha ao iniciar ${command}: ${error.message}`));
  child.unref();
}

async function startXvfb(number) {
  if (!hasCommand("Xvfb")) return false;
  // Remove lock/socket orfaos deixados por um Xvfb que morreu.
  await fs.rm(`/tmp/.X${number}-lock`, { force: true });
  await fs.rm(`/tmp/.X11-unix/X${number}`, { force: true });
  spawnDaemon("Xvfb", [`:${number}`, "-screen", "0", `${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24`, "-nolisten", "tcp"]);
  return waitFor(() => isLocalDisplayAlive(number));
}

/** Garante um display grafico para o navegador visivel. Windows/macOS usam a area de trabalho real. */
export async function ensureDisplay() {
  if (process.platform === "win32" || process.platform === "darwin") return { ok: true, local: true };
  const number = displayNumber(DISPLAY);
  // Display remoto (host:0): nao temos como validar localmente, confiamos na configuracao.
  if (number === null) return { ok: Boolean(process.env.DISPLAY), display: DISPLAY };
  if (isLocalDisplayAlive(number)) return { ok: true, display: DISPLAY };
  if (!displayCheck) displayCheck = startXvfb(number).finally(() => { displayCheck = null; });
  const started = await displayCheck;
  return { ok: started, started, display: DISPLAY };
}

async function startLiveView(port) {
  if (!hasCommand("x11vnc") || !hasCommand("websockify") || !existsSync(NOVNC_WEB_DIR)) {
    return { ok: false, reason: "x11vnc/noVNC nao instalados no servidor (veja o Dockerfile)." };
  }
  if (!(await isPortOpen(VNC_PORT))) {
    // -viewonly: quem assiste nao consegue clicar/digitar no navegador do robo.
    spawnDaemon("x11vnc", ["-display", DISPLAY, "-localhost", "-rfbport", String(VNC_PORT), "-viewonly", "-shared", "-forever", "-nopw", "-quiet", "-noxdamage"]);
    if (!(await waitFor(() => isPortOpen(VNC_PORT)))) return { ok: false, reason: "x11vnc nao respondeu." };
  }
  if (!(await isPortOpen(port))) {
    spawnDaemon("websockify", ["--web", NOVNC_WEB_DIR, String(port), `localhost:${VNC_PORT}`]);
    if (!(await waitFor(() => isPortOpen(port)))) return { ok: false, reason: `noVNC nao respondeu na porta ${port}.` };
  }
  return { ok: true };
}

/** Sobe (se preciso) o x11vnc + noVNC sobre o display e devolve como o front deve se conectar. */
export async function ensureLiveView() {
  const port = config.rpa.liveViewPort;
  if (process.platform !== "linux" || !port) return null;
  if (!liveViewCheck) liveViewCheck = startLiveView(port).finally(() => { liveViewCheck = null; });
  const result = await liveViewCheck;
  if (!result.ok) return { error: result.reason };
  return { port, url: config.rpa.liveViewUrl };
}
