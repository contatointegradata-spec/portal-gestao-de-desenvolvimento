import crypto from "node:crypto";
import express from "express";
import { config } from "../config.js";
import { getDb, withTransaction } from "../db.js";
import { isManager, requireAuth, requireManager } from "../lib/auth.js";
import { resolveDepartment } from "../lib/departments.js";
import { asyncRouter, badRequest, forbidden, HttpError, normalizeEmail, notFound, nowIso, parseJson, trimText } from "../lib/http.js";
import { normalizeLanguage } from "../rpa/interpreters.js";
import { getActiveRunForProject, sanitizeFileName, startRun, validateCode } from "../rpa/runner.js";
import { computeNextRun, normalizeSchedule, validateSchedule } from "../rpa/schedule.js";

const router = asyncRouter();

export const PROJECT_STATUSES = ["ativo", "desenvolvimento", "manutencao", "arquivado"];
export const PROJECT_CATEGORIES = ["interno", "cliente", "pessoal", "estudo"];
const BROWSER_MODES = ["auto", "headless", "visible"];
const MAX_FILES_PER_PROJECT = 20;
const MAX_SCREENSHOT_CHARS = 3_000_000;

const PROJECT_SELECT = `
  SELECT p.*, u.email AS ownerEmail, u.nome AS ownerName, d.nome AS departmentName, rr.nome AS runnerName,
    (SELECT COUNT(*) FROM project_files f WHERE f.projectId = p.id) AS fileCount
  FROM projects p
  LEFT JOIN users u ON u.id = p.responsibleUserId
  LEFT JOIN departments d ON d.id = p.departmentId
  LEFT JOIN rpa_runners rr ON rr.id = p.runnerId
`;

export function canAccessProject(user, project) {
  return isManager(user) || project.responsibleUserId === user.id;
}

export function canRunProject(user, project) {
  return isManager(user) || (project.responsibleUserId === user.id && project.systemType === "rpa");
}

export function serializeProject(row, user, { includeCode = false } = {}) {
  const schedule = normalizeSchedule(parseJson(row.scheduleConfig, {}));
  const activeRun = getActiveRunForProject(row.id);
  const isRpa = row.systemType === "rpa";
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao || "",
    url: row.url || "",
    repositorio: row.repositorio || "",
    status: row.status,
    tecnologias: parseJson(row.tecnologias, []),
    categoria: row.categoria,
    screenshot: row.screenshot || "",
    observacoes: row.observacoes || "",
    systemType: isRpa ? "rpa" : "common",
    responsibleUserId: row.responsibleUserId || null,
    ownerEmail: row.ownerEmail || "",
    ownerName: row.ownerName || "",
    departmentId: row.departmentId || null,
    department: row.departmentName || "",
    language: isRpa ? normalizeLanguage(row.runtimeLanguage) || "python" : "",
    schedule,
    nextRunAt: isRpa && row.status !== "arquivado" ? computeNextRun(schedule) : null,
    // 0 = sem limite de tempo.
    timeoutSeconds: Number.isInteger(row.timeoutSeconds) ? row.timeoutSeconds : config.rpa.defaultTimeoutSeconds,
    browserMode: row.browserMode || "auto",
    runnerId: isRpa ? row.runnerId || null : null,
    runnerName: isRpa ? row.runnerName || "" : "",
    lastValidationStatus: row.lastValidationStatus || "",
    lastValidationMessage: row.lastValidationMessage || "",
    lastRunStatus: activeRun ? "running" : row.lastRunStatus || "",
    lastRunAt: row.lastRunAt || null,
    lastRunOutput: row.lastRunOutput || "",
    activeRunId: activeRun?.id || null,
    fileCount: Number(row.fileCount || 0),
    createdAt: row.dataCriacao,
    updatedAt: row.dataAtualizacao,
    permissions: {
      canEdit: isManager(user),
      canRun: isRpa && canRunProject(user, row)
    },
    ...(includeCode ? { code: row.code || "" } : {})
  };
}

async function loadProject(db, id) {
  return db.get(`${PROJECT_SELECT} WHERE p.id = ?`, id);
}

async function loadAccessibleProject(db, user, id) {
  const project = await loadProject(db, id);
  if (!project || !canAccessProject(user, project)) throw notFound("Sistema nao encontrado.");
  return project;
}

async function listFiles(db, projectId) {
  const rows = await db.all(
    "SELECT id, fileName, mimeType, fileSize, createdAt FROM project_files WHERE projectId = ? ORDER BY createdAt ASC",
    projectId
  );
  return rows.map((row) => ({ ...row, fileSize: Number(row.fileSize || 0) }));
}

function parseTechnologies(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((item) => trimText(item)).filter(Boolean))].slice(0, 30);
}

/** Monta o registro final (merge do payload com o existente) e valida as regras de negocio. */
async function buildProjectRecord(db, actor, payload, existing) {
  const pick = (key, fallback) => (payload[key] !== undefined ? payload[key] : fallback);
  const systemType = pick("systemType", existing?.systemType || "common") === "rpa" ? "rpa" : "common";
  const isRpa = systemType === "rpa";

  let responsibleUserId = existing?.responsibleUserId || null;
  if (payload.responsibleUserId !== undefined || payload.ownerEmail !== undefined) {
    const owner = payload.responsibleUserId
      ? await db.get("SELECT id, active FROM users WHERE id = ?", trimText(payload.responsibleUserId))
      : payload.ownerEmail ? await db.get("SELECT id, active FROM users WHERE email = ?", normalizeEmail(payload.ownerEmail)) : null;
    if (!owner) throw badRequest("Selecione um usuario responsavel valido.");
    if (!owner.active) throw badRequest("O usuario responsavel esta inativo.");
    responsibleUserId = owner.id;
  }

  let departmentId = existing?.departmentId || null;
  if (payload.departmentId !== undefined || payload.department !== undefined) {
    const department = await resolveDepartment(db, { departmentId: payload.departmentId, department: payload.department }, actor.id);
    departmentId = department?.id || null;
  }

  const record = {
    nome: trimText(pick("nome", existing?.nome)),
    descricao: trimText(pick("descricao", existing?.descricao)),
    url: trimText(pick("url", existing?.url)),
    repositorio: trimText(pick("repositorio", existing?.repositorio)),
    status: trimText(pick("status", existing?.status || "ativo")),
    tecnologias: payload.tecnologias !== undefined ? parseTechnologies(payload.tecnologias) : parseJson(existing?.tecnologias, []),
    categoria: trimText(pick("categoria", existing?.categoria || "interno")),
    screenshot: String(pick("screenshot", existing?.screenshot || "") || ""),
    observacoes: trimText(pick("observacoes", existing?.observacoes)),
    systemType,
    responsibleUserId,
    departmentId,
    runtimeLanguage: isRpa ? normalizeLanguage(pick("language", existing?.runtimeLanguage)) : "",
    code: isRpa ? String(pick("code", existing?.code || "") || "") : "",
    schedule: isRpa ? normalizeSchedule(payload.schedule !== undefined ? payload.schedule : parseJson(existing?.scheduleConfig, {})) : normalizeSchedule({ mode: "manual" }),
    timeoutSeconds: Number(pick("timeoutSeconds", existing?.timeoutSeconds ?? config.rpa.defaultTimeoutSeconds)),
    browserMode: trimText(pick("browserMode", existing?.browserMode || "auto")),
    runnerId: isRpa ? trimText(pick("runnerId", existing?.runnerId || "")) || null : null
  };

  if (isRpa && !record.tecnologias.length) record.tecnologias = [record.runtimeLanguage === "javascript" ? "JavaScript" : "Python", "RPA"];

  const errors = [];
  if (!record.nome) errors.push("Informe o nome do sistema.");
  if (record.nome.length > 120) errors.push("O nome deve ter no maximo 120 caracteres.");
  if (!record.descricao) errors.push("Informe a descricao.");
  if (!isRpa && !record.url) errors.push("Informe a URL de acesso do sistema.");
  if (!isRpa && !record.tecnologias.length) errors.push("Informe ao menos uma tecnologia.");
  if (!PROJECT_STATUSES.includes(record.status)) errors.push("Status invalido.");
  if (!PROJECT_CATEGORIES.includes(record.categoria)) errors.push("Categoria invalida.");
  if (!record.responsibleUserId) errors.push("Selecione o usuario responsavel.");
  if (record.screenshot && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(record.screenshot)) errors.push("Imagem do sistema invalida.");
  if (record.screenshot.length > MAX_SCREENSHOT_CHARS) errors.push("Imagem do sistema muito grande.");
  if (isRpa) {
    if (!record.runtimeLanguage) errors.push("Selecione a linguagem do RPA (Python ou JavaScript).");
    if (!record.code.trim()) errors.push("Informe o codigo do RPA.");
    if (record.code.length > 300_000) errors.push("O codigo excede o limite de 300 mil caracteres.");
    const scheduleError = validateSchedule(record.schedule);
    if (scheduleError) errors.push(scheduleError);
    const timeoutOk = record.timeoutSeconds === 0 || (record.timeoutSeconds >= 10 && record.timeoutSeconds <= config.rpa.maxTimeoutSeconds);
    if (!Number.isInteger(record.timeoutSeconds) || !timeoutOk) {
      errors.push(`O tempo limite deve ficar entre 10 segundos e ${Math.round(config.rpa.maxTimeoutSeconds / 60)} minutos (ou sem limite).`);
    }
    if (!BROWSER_MODES.includes(record.browserMode)) errors.push("Modo de navegador invalido.");
    if (record.runnerId && record.runnerId !== existing?.runnerId) {
      const runner = await db.get("SELECT active FROM rpa_runners WHERE id = ?", record.runnerId);
      if (!runner) errors.push("Servidor de execucao nao encontrado.");
      else if (!runner.active) errors.push("O servidor de execucao selecionado esta desativado.");
    }
  }
  if (errors.length) throw new HttpError(400, errors[0], { errors });
  return record;
}

// ─── Listagem e detalhe ───────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const rows = isManager(req.user)
    ? await db.all(`${PROJECT_SELECT} ORDER BY p.dataAtualizacao DESC`)
    : await db.all(`${PROJECT_SELECT} WHERE p.responsibleUserId = ? ORDER BY p.dataAtualizacao DESC`, req.user.id);
  res.json(rows.map((row) => serializeProject(row, req.user)));
});

router.get("/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const row = await loadAccessibleProject(db, req.user, req.params.id);
  res.json({ ...serializeProject(row, req.user, { includeCode: true }), files: await listFiles(db, row.id) });
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.post("/", requireManager, async (req, res) => {
  const db = await getDb();
  const record = await buildProjectRecord(db, req.user, req.body || {}, null);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO projects (id, nome, descricao, url, repositorio, status, tecnologias, categoria, screenshot, observacoes, createdByUserId, systemType,
       responsibleUserId, departmentId, runtimeLanguage, code, scheduleConfig, timeoutSeconds, browserMode, runnerId, lastValidationStatus, lastValidationMessage,
       lastRunStatus, lastRunAt, lastRunOutput, dataCriacao, dataAtualizacao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', NULL, '', ?, ?)`,
    id, record.nome, record.descricao, record.url, record.repositorio, record.status, JSON.stringify(record.tecnologias), record.categoria,
    record.screenshot, record.observacoes, req.user.id, record.systemType, record.responsibleUserId, record.departmentId, record.runtimeLanguage,
    record.code, JSON.stringify(record.schedule), record.timeoutSeconds, record.browserMode, record.runnerId, now, now
  );
  const created = await loadProject(db, id);
  res.status(201).json({ ...serializeProject(created, req.user, { includeCode: true }), files: [] });
});

router.patch("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await loadProject(db, req.params.id);
  if (!existing) throw notFound("Sistema nao encontrado.");
  const record = await buildProjectRecord(db, req.user, req.body || {}, existing);
  const codeChanged = record.code !== (existing.code || "") || record.runtimeLanguage !== (existing.runtimeLanguage || "");
  const becameCommon = existing.systemType === "rpa" && record.systemType !== "rpa";
  if (becameCommon && getActiveRunForProject(existing.id)) throw new HttpError(409, "Aguarde a execucao em andamento terminar antes de alterar o tipo do sistema.");

  await withTransaction(db, async () => {
    await db.run(
      `UPDATE projects SET nome = ?, descricao = ?, url = ?, repositorio = ?, status = ?, tecnologias = ?, categoria = ?, screenshot = ?, observacoes = ?,
         systemType = ?, responsibleUserId = ?, departmentId = ?, runtimeLanguage = ?, code = ?, scheduleConfig = ?, timeoutSeconds = ?, browserMode = ?,
         runnerId = ?, lastValidationStatus = ?, lastValidationMessage = ?, dataAtualizacao = ?
       WHERE id = ?`,
      record.nome, record.descricao, record.url, record.repositorio, record.status, JSON.stringify(record.tecnologias), record.categoria,
      record.screenshot, record.observacoes, record.systemType, record.responsibleUserId, record.departmentId, record.runtimeLanguage, record.code,
      JSON.stringify(record.schedule), record.timeoutSeconds, record.browserMode, record.runnerId,
      codeChanged ? "" : existing.lastValidationStatus || "", codeChanged ? "" : existing.lastValidationMessage || "", nowIso(), existing.id
    );
    if (becameCommon) await db.run("DELETE FROM project_files WHERE projectId = ?", existing.id);
  });
  const updated = await loadProject(db, existing.id);
  res.json({ ...serializeProject(updated, req.user, { includeCode: true }), files: await listFiles(db, existing.id) });
});

router.delete("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await loadProject(db, req.params.id);
  if (!existing) throw notFound("Sistema nao encontrado.");
  if (getActiveRunForProject(existing.id)) throw new HttpError(409, "Cancele a execucao em andamento antes de excluir o sistema.");
  await db.run("DELETE FROM projects WHERE id = ?", existing.id);
  res.status(204).send();
});

router.post("/:id/duplicate", requireManager, async (req, res) => {
  const db = await getDb();
  const source = await loadProject(db, req.params.id);
  if (!source) throw notFound("Sistema nao encontrado.");
  const id = crypto.randomUUID();
  const now = nowIso();
  await withTransaction(db, async () => {
    await db.run(
      `INSERT INTO projects (id, nome, descricao, url, repositorio, status, tecnologias, categoria, screenshot, observacoes, createdByUserId, systemType,
         responsibleUserId, departmentId, runtimeLanguage, code, scheduleConfig, timeoutSeconds, browserMode, runnerId, lastValidationStatus, lastValidationMessage,
         lastRunStatus, lastRunAt, lastRunOutput, dataCriacao, dataAtualizacao)
       SELECT ?, substr(nome || ' (copia)', 1, 120), descricao, url, repositorio, 'desenvolvimento', tecnologias, categoria, screenshot, observacoes, ?, systemType,
         responsibleUserId, departmentId, runtimeLanguage, code, ?, timeoutSeconds, browserMode, runnerId, '', '', '', NULL, '', ?, ?
       FROM projects WHERE id = ?`,
      id, req.user.id, JSON.stringify(normalizeSchedule({ mode: "manual" })), now, now, source.id
    );
    await db.run(
      `INSERT INTO project_files (id, projectId, fileName, mimeType, fileSize, content, createdByUserId, createdAt)
       SELECT lower(hex(randomblob(16))), ?, fileName, mimeType, fileSize, content, ?, ? FROM project_files WHERE projectId = ?`,
      id, req.user.id, now, source.id
    );
  });
  res.status(201).json(serializeProject(await loadProject(db, id), req.user));
});

// ─── Validacao de codigo (rascunho ou salvo) ──────────────────────────────────
router.post("/validate-code", requireManager, async (req, res) => {
  res.json(await validateCode(req.body?.language, req.body?.code));
});

router.post("/:id/validate", requireManager, async (req, res) => {
  const db = await getDb();
  const project = await loadProject(db, req.params.id);
  if (!project) throw notFound("Sistema nao encontrado.");
  if (project.systemType !== "rpa") throw badRequest("Validacao disponivel apenas para RPA.");
  const result = await validateCode(project.runtimeLanguage, project.code);
  await db.run(
    "UPDATE projects SET lastValidationStatus = ?, lastValidationMessage = ? WHERE id = ?",
    result.ok ? "success" : "error", [result.message, ...(result.warnings || [])].join(" "), project.id
  );
  res.json({ ...result, project: serializeProject(await loadProject(db, project.id), req.user) });
});

// ─── Execucao ─────────────────────────────────────────────────────────────────
router.post("/:id/runs", requireAuth, async (req, res) => {
  const db = await getDb();
  const project = await loadAccessibleProject(db, req.user, req.params.id);
  if (!canRunProject(req.user, project)) throw forbidden("Voce nao tem permissao para executar este RPA.");
  if (project.status === "arquivado") throw badRequest("Sistemas arquivados nao podem ser executados.");
  const run = await startRun({ project, triggerType: "manual", userId: req.user.id });
  res.status(202).json({ runId: run.id, status: run.status, startedAt: run.startedAt.toISOString() });
});

router.get("/:id/runs", requireAuth, async (req, res) => {
  const db = await getDb();
  const project = await loadAccessibleProject(db, req.user, req.params.id);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = await db.all(
    `SELECT r.id, r.projectId, r.triggeredByUserId, r.triggerType, r.triggerValue, r.language, r.status, r.exitCode, r.durationMs,
        r.errorMessage, r.createdAt, r.finishedAt, u.nome AS triggeredByName,
        (SELECT COUNT(*) FROM project_run_artifacts a WHERE a.runId = r.id) AS artifactCount
     FROM project_runs r LEFT JOIN users u ON u.id = r.triggeredByUserId
     WHERE r.projectId = ? ORDER BY r.createdAt DESC LIMIT ?`,
    project.id, limit
  );
  res.json(rows.map((row) => ({ ...row, artifactCount: Number(row.artifactCount || 0) })));
});

// ─── Arquivos de entrada ──────────────────────────────────────────────────────
router.get("/:id/files", requireAuth, async (req, res) => {
  const db = await getDb();
  const project = await loadAccessibleProject(db, req.user, req.params.id);
  res.json(await listFiles(db, project.id));
});

router.post(
  "/:id/files",
  requireManager,
  express.raw({ type: () => true, limit: config.rpa.maxFileBytes }),
  async (req, res) => {
    const db = await getDb();
    const project = await loadProject(db, req.params.id);
    if (!project) throw notFound("Sistema nao encontrado.");
    if (project.systemType !== "rpa") throw badRequest("Arquivos de entrada so podem ser enviados para RPA.");
    const rawName = decodeURIComponent(String(req.headers["x-file-name"] || ""));
    const fileName = sanitizeFileName(rawName);
    if (!rawName) throw badRequest("Nome do arquivo nao informado.");
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!content.length) throw badRequest("Arquivo vazio.");

    const existing = await db.get("SELECT id FROM project_files WHERE projectId = ? AND fileName = ?", project.id, fileName);
    const mimeType = trimText(req.headers["content-type"]) || "application/octet-stream";
    if (existing) {
      await db.run(
        "UPDATE project_files SET content = ?, fileSize = ?, mimeType = ?, createdByUserId = ?, createdAt = ? WHERE id = ?",
        content, content.length, mimeType, req.user.id, nowIso(), existing.id
      );
    } else {
      const count = await db.get("SELECT COUNT(*) AS total FROM project_files WHERE projectId = ?", project.id);
      if (Number(count.total) >= MAX_FILES_PER_PROJECT) throw badRequest(`Limite de ${MAX_FILES_PER_PROJECT} arquivos por RPA atingido.`);
      await db.run(
        "INSERT INTO project_files (id, projectId, fileName, mimeType, fileSize, content, createdByUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        crypto.randomUUID(), project.id, fileName, mimeType, content.length, content, req.user.id, nowIso()
      );
    }
    await db.run("UPDATE projects SET dataAtualizacao = ? WHERE id = ?", nowIso(), project.id);
    res.status(existing ? 200 : 201).json({ replaced: Boolean(existing), files: await listFiles(db, project.id) });
  }
);

router.get("/:id/files/:fileId/download", requireAuth, async (req, res) => {
  const db = await getDb();
  const project = await loadAccessibleProject(db, req.user, req.params.id);
  const file = await db.get("SELECT * FROM project_files WHERE id = ? AND projectId = ?", req.params.fileId, project.id);
  if (!file) throw notFound("Arquivo nao encontrado.");
  res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.send(file.content);
});

router.delete("/:id/files/:fileId", requireManager, async (req, res) => {
  const db = await getDb();
  const result = await db.run("DELETE FROM project_files WHERE id = ? AND projectId = ?", req.params.fileId, req.params.id);
  if (!result.changes) throw notFound("Arquivo nao encontrado.");
  res.json({ files: await listFiles(db, req.params.id) });
});

export default router;
