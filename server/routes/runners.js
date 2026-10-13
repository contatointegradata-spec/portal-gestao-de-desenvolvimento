// Cadastro dos servidores de execucao de RPA (Configuracoes › Servidores RPA).
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { isManager, requireAuth, requireManager } from "../lib/auth.js";
import { asyncRouter, badRequest, conflict, forbidden, HttpError, notFound, nowIso, parseJson, trimText } from "../lib/http.js";
import { encryptSecret, hashToken, randomToken } from "../lib/security.js";
import { forgetRunner, isRunnerOnline, lastScreen, queuedCount, runnerLastSeen, watchScreen } from "../rpa/remote.js";
import { listActiveRuns } from "../rpa/runner.js";
import { AGENT_VERSION } from "./agent.js";

const router = asyncRouter();

const RUNNER_SELECT = `
  SELECT r.*, (SELECT COUNT(*) FROM projects p WHERE p.runnerId = r.id) AS projectCount
  FROM rpa_runners r
`;

function newToken() {
  return `rpa_${randomToken(24)}`;
}

function serializeRunner(row) {
  const memorySeen = runnerLastSeen(row.id);
  const lastSeenAt = memorySeen ? new Date(memorySeen).toISOString() : row.lastSeenAt || null;
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao || "",
    hostname: row.hostname || "",
    username: row.username || "",
    // A senha nunca sai do servidor: o front so sabe se existe.
    hasPassword: Boolean(row.password),
    active: Boolean(row.active),
    online: Boolean(row.active) && isRunnerOnline(row.id),
    lastSeenAt,
    agent: parseJson(row.agentInfo, null),
    latestAgentVersion: AGENT_VERSION,
    runningCount: listActiveRuns().filter((run) => run.runnerId === row.id).length,
    queuedCount: queuedCount(row.id),
    projectCount: Number(row.projectCount || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function readPayload(body, existing) {
  const pick = (key, fallback) => (body[key] !== undefined ? body[key] : fallback);
  const record = {
    nome: trimText(pick("nome", existing?.nome)),
    descricao: trimText(pick("descricao", existing?.descricao || "")),
    hostname: trimText(pick("hostname", existing?.hostname || "")),
    username: trimText(pick("username", existing?.username || "")),
    active: pick("active", existing ? Boolean(existing.active) : true) ? 1 : 0
  };
  if (!record.nome) throw badRequest("Informe o nome do servidor.");
  if (record.nome.length > 80) throw badRequest("O nome deve ter no maximo 80 caracteres.");
  if (!record.hostname) throw badRequest("Informe o hostname ou IP do servidor.");
  if (record.hostname.length > 255 || record.username.length > 255) throw badRequest("Hostname ou usuario muito longo.");
  return record;
}

async function loadRunner(db, id) {
  const row = await db.get(`${RUNNER_SELECT} WHERE r.id = ?`, id);
  if (!row) throw notFound("Servidor nao encontrado.");
  return row;
}

router.get("/", requireManager, async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`${RUNNER_SELECT} ORDER BY r.nome COLLATE NOCASE`);
  res.json(rows.map(serializeRunner));
});

router.post("/", requireManager, async (req, res) => {
  const db = await getDb();
  const body = req.body || {};
  const record = readPayload(body, null);
  if (await db.get("SELECT id FROM rpa_runners WHERE nome = ? COLLATE NOCASE", record.nome)) throw conflict("Ja existe um servidor com este nome.");
  const id = crypto.randomUUID();
  const token = newToken();
  const now = nowIso();
  await db.run(
    `INSERT INTO rpa_runners (id, nome, descricao, hostname, username, password, tokenHash, active, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, record.nome, record.descricao, record.hostname, record.username, body.password ? encryptSecret(String(body.password)) : null,
    hashToken(token), record.active, req.user.id, now, now
  );
  // O token so e exibido agora: no banco fica apenas o hash.
  res.status(201).json({ runner: serializeRunner(await loadRunner(db, id)), token });
});

router.patch("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await loadRunner(db, req.params.id);
  const body = req.body || {};
  const record = readPayload(body, existing);
  const duplicate = await db.get("SELECT id FROM rpa_runners WHERE nome = ? COLLATE NOCASE AND id <> ?", record.nome, existing.id);
  if (duplicate) throw conflict("Ja existe um servidor com este nome.");
  // password: undefined mantem, "" remove, texto substitui.
  const password = body.password === undefined ? existing.password : body.password ? encryptSecret(String(body.password)) : null;
  await db.run(
    "UPDATE rpa_runners SET nome = ?, descricao = ?, hostname = ?, username = ?, password = ?, active = ?, updatedAt = ? WHERE id = ?",
    record.nome, record.descricao, record.hostname, record.username, password, record.active, nowIso(), existing.id
  );
  if (!record.active) forgetRunner(existing.id);
  res.json(serializeRunner(await loadRunner(db, existing.id)));
});

router.post("/:id/token", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await loadRunner(db, req.params.id);
  const token = newToken();
  await db.run("UPDATE rpa_runners SET tokenHash = ?, updatedAt = ? WHERE id = ?", hashToken(token), nowIso(), existing.id);
  forgetRunner(existing.id);
  res.json({ runner: serializeRunner(await loadRunner(db, existing.id)), token });
});

/**
 * Tela ao vivo do servidor (SSE): eventos "status" e "frame" (JPEG em data URL).
 * Enquanto houver alguem conectado aqui, o agente captura e envia a tela.
 */
router.get("/:id/screen/stream", requireAuth, async (req, res) => {
  const db = await getDb();
  const runner = await db.get("SELECT id, nome, active FROM rpa_runners WHERE id = ?", req.params.id);
  if (!runner) throw notFound("Servidor nao encontrado.");
  if (!isManager(req.user)) {
    // Usuario comum: so ve a tela de servidores usados pelos RPAs pelos quais e responsavel.
    const linked = await db.get("SELECT id FROM projects WHERE runnerId = ? AND responsibleUserId = ? LIMIT 1", runner.id, req.user.id);
    if (!linked) throw forbidden("Sem permissao para ver a tela deste servidor.");
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const online = runner.active && isRunnerOnline(runner.id);
  const current = lastScreen(runner.id);
  send("status", online
    ? current.status || { available: true, message: "" }
    : { available: false, message: runner.active ? "Agente offline: a tela aparece quando o agente voltar a se conectar." : "Servidor desativado." });
  // Ultimo quadro recente da sessao anterior, para nao abrir com a tela vazia.
  if (online && current.frame && Date.now() - new Date(current.frame.ts).getTime() < 15_000) send("frame", current.frame);

  const unsubscribe = watchScreen(runner.id, (type, payload) => send(type, payload));
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.delete("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await loadRunner(db, req.params.id);
  if (listActiveRuns().some((run) => run.runnerId === existing.id)) {
    throw new HttpError(409, "Ha execucoes em andamento neste servidor. Aguarde ou cancele antes de excluir.");
  }
  await db.run("UPDATE projects SET runnerId = NULL WHERE runnerId = ?", existing.id);
  await db.run("DELETE FROM rpa_runners WHERE id = ?", existing.id);
  forgetRunner(existing.id);
  res.json({ ok: true, detachedProjects: Number(existing.projectCount || 0) });
});

export default router;
