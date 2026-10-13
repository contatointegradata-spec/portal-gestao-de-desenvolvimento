// Fila de jobs e presenca dos agentes instalados em servidores remotos (rpa_runners).
// O agente nunca recebe conexoes: ele consulta a plataforma (long polling) e reporta
// logs/arquivos por HTTP, entao basta o servidor remoto alcancar a porta da plataforma.

export const ONLINE_WINDOW_MS = 60 * 1000;

const queues = new Map(); // runnerId -> [{ state, payload }]
const waiters = new Map(); // runnerId -> [resolve]
const lastSeen = new Map(); // runnerId -> timestamp (ms)

export function touchRunner(runnerId) {
  lastSeen.set(runnerId, Date.now());
}

export function runnerLastSeen(runnerId) {
  return lastSeen.get(runnerId) || null;
}

export function isRunnerOnline(runnerId) {
  const seen = lastSeen.get(runnerId);
  return Boolean(seen && Date.now() - seen < ONLINE_WINDOW_MS);
}

export function forgetRunner(runnerId) {
  lastSeen.delete(runnerId);
  for (const resolve of waiters.get(runnerId) || []) resolve(null);
  waiters.delete(runnerId);
}

export function queuedCount(runnerId) {
  return (queues.get(runnerId) || []).length;
}

export function enqueueJob(runnerId, job) {
  const pending = waiters.get(runnerId);
  if (pending?.length) {
    pending.shift()(job);
    return;
  }
  if (!queues.has(runnerId)) queues.set(runnerId, []);
  queues.get(runnerId).push(job);
}

/** Remove um job que ainda nao foi entregue ao agente. Retorna true se estava na fila. */
export function dequeueJob(runnerId, runId) {
  const queue = queues.get(runnerId) || [];
  const index = queue.findIndex((job) => job.state.id === runId);
  if (index === -1) return false;
  queue.splice(index, 1);
  return true;
}

// ─── Tela ao vivo do servidor ─────────────────────────────────────────────────
// O agente so captura a tela enquanto houver alguem assistindo na plataforma.
const screens = new Map(); // runnerId -> { viewers: Set, frame, status, demand: [] }

function screenState(runnerId) {
  if (!screens.has(runnerId)) screens.set(runnerId, { viewers: new Set(), frame: null, status: null, demand: [] });
  return screens.get(runnerId);
}

export function isScreenWatched(runnerId) {
  return screenState(runnerId).viewers.size > 0;
}

/** Inscreve um espectador. listener(type, payload) recebe "frame" e "status". Retorna o cancelamento. */
export function watchScreen(runnerId, listener) {
  const screen = screenState(runnerId);
  screen.viewers.add(listener);
  for (const resolve of screen.demand.splice(0)) resolve(true);
  return () => screen.viewers.delete(listener);
}

export function lastScreen(runnerId) {
  const screen = screenState(runnerId);
  return { frame: screen.frame, status: screen.status };
}

/** Long polling do agente: responde assim que alguem abrir a tela (ou false no timeout). */
export function waitScreenDemand(runnerId, timeoutMs, signal) {
  const screen = screenState(runnerId);
  if (screen.viewers.size) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(timer);
      const index = screen.demand.indexOf(finish);
      if (index !== -1) screen.demand.splice(index, 1);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    screen.demand.push(finish);
    signal?.addEventListener("abort", () => finish(false));
  });
}

function broadcastScreen(screen, type, payload) {
  for (const listener of screen.viewers) {
    try { listener(type, payload); } catch { /* espectador desconectado */ }
  }
}

export function pushScreenFrame(runnerId, { data, width, height }) {
  const screen = screenState(runnerId);
  screen.frame = { image: `data:image/jpeg;base64,${data.toString("base64")}`, width, height, ts: new Date().toISOString() };
  if (!screen.status?.available) {
    screen.status = { available: true, message: "" };
    broadcastScreen(screen, "status", screen.status);
  }
  broadcastScreen(screen, "frame", screen.frame);
}

export function pushScreenStatus(runnerId, { available, message }) {
  const screen = screenState(runnerId);
  screen.status = { available: Boolean(available), message: String(message || "").slice(0, 500), ts: new Date().toISOString() };
  broadcastScreen(screen, "status", screen.status);
}

/** Devolve ao inicio da fila um job cuja entrega falhou (agente desconectou no meio da resposta). */
export function requeueFront(runnerId, job) {
  if (!queues.has(runnerId)) queues.set(runnerId, []);
  queues.get(runnerId).unshift(job);
}

/** Long polling: entrega o proximo job da fila ou espera ate `timeoutMs`. */
export function takeNextJob(runnerId, timeoutMs, signal) {
  const queue = queues.get(runnerId) || [];
  if (queue.length) return Promise.resolve(queue.shift());
  return new Promise((resolve) => {
    const list = waiters.get(runnerId) || [];
    const finish = (job) => {
      clearTimeout(timer);
      const current = waiters.get(runnerId) || [];
      const index = current.indexOf(finish);
      if (index !== -1) current.splice(index, 1);
      resolve(job);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    list.push(finish);
    waiters.set(runnerId, list);
    signal?.addEventListener("abort", () => {
      // Conexao do agente caiu antes de receber algo: o job (se chegar depois) vai para a fila.
      finish(null);
    });
  });
}
