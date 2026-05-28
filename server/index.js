import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import { initDb, getDb } from "./db.js";
import { executeRpaCode, normalizeLanguage, normalizeRpaProjectPayload, normalizeScheduleValues, validateRpaCode } from "./rpa.js";

const app = express();
const port = process.env.PORT || 5174;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "..", "dist");
const SESSION_DURATION_DAYS = 7;
const RESET_TOKEN_DURATION_MINUTES = 30;
const MAIL_FROM = "kelvensilva.unimed@gmail.com";
const MAIL_USER = "kelvensilva.unimed@gmail.com";
const MAIL_APP_PASSWORD = "cywo zhhr tktp egdf";
const MASTER_EMAIL = "kelvensilva.unimed@gmail.com";
const VALID_ROLES = ["super_admin", "admin", "user"];
const VALID_TICKET_CATEGORIES = ["solicitacao", "duvida", "incidente", "outro"];
const VALID_TICKET_PRIORITIES = ["baixa", "media", "alta", "critica"];
const VALID_TICKET_STATUSES = ["aberto", "em_tratamento", "aguardando_resposta_usuario", "resolvido", "encerrado"];
let mailTransporter;
let schedulerStarted = false;

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
for (const method of ["get", "post", "put", "patch", "delete"]) {
  const original = app[method].bind(app);
  app[method] = (...args) => {
    const last = args.at(-1);
    if (typeof last === "function") {
      args[args.length - 1] = asyncHandler(last);
    }
    return original(...args);
  };
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password || "";
  if (!email || !password) return res.status(400).json({ error: "Email e senha sao obrigatorios." });

  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user || !user.active) return res.status(401).json({ error: "Credenciais invalidas." });

  const passwordHash = hashPassword(password, user.passwordSalt);
  if (!safeEqual(passwordHash, user.passwordHash)) return res.status(401).json({ error: "Credenciais invalidas." });

  await db.run("DELETE FROM user_sessions WHERE expiresAt <= ?", new Date().toISOString());
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.run("INSERT INTO user_sessions (tokenHash, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)", tokenHash, user.id, now.toISOString(), expiresAt);
  await db.run("UPDATE users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?", now.toISOString(), now.toISOString(), user.id);

  res.json({ token, user: await serializeUser(await getDb(), user) });
});

app.post("/api/auth/register", async (_req, res) => {
  res.status(403).json({ error: "Criacao publica de usuarios foi desativada. Use um Super Admin." });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Email e obrigatorio." });

  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user) return res.json({ message: "Se o email existir, enviaremos o codigo de recuperacao." });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10 minutes
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  const tokenHash = hashToken(code);

  await db.run("DELETE FROM password_reset_tokens WHERE userId = ?", user.id);
  await db.run("INSERT INTO password_reset_tokens (tokenHash, userId, createdAt, expiresAt, usedAt) VALUES (?, ?, ?, ?, NULL)", tokenHash, user.id, now.toISOString(), expiresAt);

  const sent = await sendResetCodeEmail({ to: user.email, name: user.nome, code }).catch((err) => {
    console.error("Erro ao enviar email:", err);
    return false;
  });
  
  if (!sent) {
    return res.status(500).json({ error: "Erro ao enviar email de recuperacao. Verifique as configuracoes do servidor." });
  }

  res.json({ message: "Codigo de recuperacao enviado para o seu email." });
});

app.post("/api/auth/verify-reset-code", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  if (!email || !code) return res.status(400).json({ error: "Email e codigo sao obrigatorios." });

  const db = await getDb();
  const user = await db.get("SELECT id FROM users WHERE email = ?", email);
  if (!user) return res.status(400).json({ error: "Usuario nao encontrado." });

  const tokenHash = hashToken(code);
  const resetRow = await db.get("SELECT * FROM password_reset_tokens WHERE tokenHash = ? AND userId = ? AND usedAt IS NULL AND expiresAt > ?", tokenHash, user.id, new Date().toISOString());
  
  if (!resetRow) return res.status(400).json({ error: "Codigo invalido ou expirado." });
  res.json({ ok: true, message: "Codigo validado com sucesso." });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  const novaSenha = req.body?.novaSenha || "";
  
  if (!email || !code || !novaSenha) return res.status(400).json({ error: "Email, codigo e nova senha sao obrigatorios." });
  if (novaSenha.length < 6) return res.status(400).json({ error: "Nova senha deve ter pelo menos 6 caracteres." });

  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user) return res.status(400).json({ error: "Usuario nao encontrado." });

  const tokenHash = hashToken(code);
  const resetRow = await db.get("SELECT * FROM password_reset_tokens WHERE tokenHash = ? AND userId = ? AND usedAt IS NULL AND expiresAt > ?", tokenHash, user.id, new Date().toISOString());
  
  if (!resetRow) return res.status(400).json({ error: "Codigo invalido ou expirado." });

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(novaSenha, salt);
  const now = new Date().toISOString();
  
  await db.run("UPDATE users SET passwordHash = ?, passwordSalt = ?, updatedAt = ? WHERE id = ?", passwordHash, salt, now, user.id);
  await db.run("UPDATE password_reset_tokens SET usedAt = ? WHERE tokenHash = ?", now, tokenHash);
  await db.run("DELETE FROM user_sessions WHERE userId = ?", user.id);
  
  res.status(204).send();
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ user: await serializeUser(await getDb(), req.user) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM user_sessions WHERE tokenHash = ?", req.tokenHash);
  res.status(204).send();
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(
    "SELECT * FROM notifications WHERE recipientUserId = ? ORDER BY datetime(createdAt) DESC LIMIT 50",
    req.user.id
  );
  res.json(rows.map(serializeNotificationRow));
});

app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
  const db = await getDb();
  const notification = await db.get("SELECT * FROM notifications WHERE id = ? AND recipientUserId = ?", req.params.id, req.user.id);
  if (!notification) return res.status(404).json({ error: "Notificacao nao encontrada." });
  const now = new Date().toISOString();
  await db.run("UPDATE notifications SET readAt = COALESCE(readAt, ?) WHERE id = ?", now, notification.id);
  const updated = await db.get("SELECT * FROM notifications WHERE id = ?", notification.id);
  res.json({ notification: serializeNotificationRow(updated) });
});

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("UPDATE notifications SET readAt = COALESCE(readAt, ?) WHERE recipientUserId = ? AND readAt IS NULL", new Date().toISOString(), req.user.id);
  res.status(204).send();
});

app.put("/api/users/me/photo", requireAuth, async (req, res) => {
  const foto = typeof req.body?.foto === "string" ? req.body.foto : "";
  if (foto.length > 5_000_000) return res.status(400).json({ error: "Imagem muito grande." });
  const db = await getDb();
  await db.run("UPDATE users SET foto = ?, updatedAt = ? WHERE id = ?", foto, new Date().toISOString(), req.user.id);
  const updated = await db.get("SELECT * FROM users WHERE id = ?", req.user.id);
  res.json({ user: await serializeUser(db, updated) });
});

app.put("/api/users/me/password", requireAuth, async (req, res) => {
  const senhaAtual = req.body?.senhaAtual || "";
  const novaSenha = req.body?.novaSenha || "";
  if (!senhaAtual || !novaSenha) return res.status(400).json({ error: "Senha atual e nova senha sao obrigatorias." });
  if (novaSenha.length < 6) return res.status(400).json({ error: "Nova senha deve ter pelo menos 6 caracteres." });
  if (!safeEqual(hashPassword(senhaAtual, req.user.passwordSalt), req.user.passwordHash)) return res.status(401).json({ error: "Senha atual incorreta." });

  const db = await getDb();
  const salt = crypto.randomBytes(16).toString("hex");
  await db.run("UPDATE users SET passwordHash = ?, passwordSalt = ?, updatedAt = ? WHERE id = ?", hashPassword(novaSenha, salt), salt, new Date().toISOString(), req.user.id);
  await db.run("DELETE FROM user_sessions WHERE userId = ?", req.user.id);
  res.status(204).send();
});
app.get("/api/departments", requireRole("super_admin", "admin"), async (_req, res) => {
  const db = await getDb();
  const rows = await db.all("SELECT * FROM departments ORDER BY nome COLLATE NOCASE ASC");
  res.json(rows.map(serializeDepartmentRow));
});

app.post("/api/departments", requireRole("super_admin", "admin"), async (req, res) => {
  const nome = trimText(req.body?.nome || req.body?.department);
  const descricao = trimText(req.body?.descricao);
  if (!nome) return res.status(400).json({ error: "Nome do departamento e obrigatorio." });

  const db = await getDb();
  const existing = await db.get("SELECT * FROM departments WHERE nome = ?", nome);
  if (existing) return res.status(201).json({ department: serializeDepartmentRow(existing) });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.run("INSERT INTO departments (id, nome, descricao, ativo, createdByUserId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)", id, nome, descricao || "", 1, req.user.id, now, now);
  const created = await db.get("SELECT * FROM departments WHERE id = ?", id);
  res.status(201).json({ department: serializeDepartmentRow(created) });
});

app.patch("/api/departments/:id", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const department = await db.get("SELECT * FROM departments WHERE id = ?", req.params.id);
  if (!department) return res.status(404).json({ error: "Departamento nao encontrado." });
  const nome = trimText(req.body?.nome) || department.nome;
  const descricao = req.body?.descricao !== undefined ? trimText(req.body.descricao) : department.descricao || "";
  const ativo = req.body?.ativo === undefined ? department.ativo : boolToInt(req.body.ativo);
  await db.run("UPDATE departments SET nome = ?, descricao = ?, ativo = ?, updatedAt = ? WHERE id = ?", nome, descricao || "", ativo, new Date().toISOString(), department.id);
  const updated = await db.get("SELECT * FROM departments WHERE id = ?", department.id);
  res.json({ department: serializeDepartmentRow(updated) });
});

app.delete("/api/departments/:id", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const department = await db.get("SELECT * FROM departments WHERE id = ?", req.params.id);
  if (!department) return res.status(404).json({ error: "Departamento nao encontrado." });
  await db.run("UPDATE users SET departmentId = NULL, updatedAt = ? WHERE departmentId = ?", new Date().toISOString(), department.id);
  await db.run("UPDATE projects SET departmentId = NULL, updatedAt = ? WHERE departmentId = ?", new Date().toISOString(), department.id);
  await db.run("DELETE FROM departments WHERE id = ?", department.id);
  res.status(204).send();
});

app.get("/api/users", requireRole("super_admin", "admin"), async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`SELECT u.*, d.id AS department__id, d.nome AS department__nome, d.descricao AS department__descricao, d.ativo AS department__ativo FROM users u LEFT JOIN departments d ON d.id = u.departmentId ORDER BY u.createdAt DESC`);
  res.json(rows.map(serializeUserRow));
});

app.post("/api/users", requireRole("super_admin"), async (req, res) => {
  const nome = trimText(req.body?.nome);
  const email = normalizeEmail(req.body?.email);
  const senha = req.body?.senha || req.body?.password || "";
  const role = normalizeRole(req.body?.role || "user");
  const department = await resolveDepartmentByPayload(req.body);
  if (!nome || !email || !senha) return res.status(400).json({ error: "Nome, email e senha sao obrigatorios." });
  if (!email.includes("@")) return res.status(400).json({ error: "Email invalido." });
  if (senha.length < 6) return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres." });

  const db = await getDb();
  const existing = await db.get("SELECT id FROM users WHERE email = ?", email);
  if (existing) return res.status(409).json({ error: "Ja existe usuario com este email." });

  const now = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(senha, salt);
  const userId = crypto.randomUUID();
  try {
    await db.run(`INSERT INTO users (id, nome, email, passwordHash, passwordSalt, foto, tema, role, active, departmentId, createdByUserId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userId, nome, email, passwordHash, salt, "", "light", role, boolToInt(req.body?.active ?? 1), department?.id || null, req.user.id, now, now);
  } catch (error) {
    if (error?.code === "SQLITE_CONSTRAINT") {
      return res.status(409).json({ error: "Ja existe usuario com este email." });
    }
    throw error;
  }
  const created = await db.get("SELECT * FROM users WHERE id = ?", userId);
  res.status(201).json({ user: await serializeUser(await getDb(), created) });
});

app.patch("/api/users/:id", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const target = await db.get("SELECT * FROM users WHERE id = ?", req.params.id);
  if (!target) return res.status(404).json({ error: "Usuario nao encontrado." });
  if (req.user.role === "admin" && target.role !== "user") return res.status(403).json({ error: "Admin nao pode alterar este usuario." });

  const payload = req.body || {};
  const updates = [];
  const values = [];
  if (payload.nome !== undefined && req.user.role === "super_admin") {
    const nome = trimText(payload.nome); if (!nome) return res.status(400).json({ error: "Nome invalido." }); updates.push("nome = ?"); values.push(nome);
  }
  if (payload.email !== undefined) {
    const email = normalizeEmail(payload.email); if (!email || !email.includes("@")) return res.status(400).json({ error: "Email invalido." });
    const existingEmail = await db.get("SELECT id FROM users WHERE email = ? AND id <> ?", email, target.id);
    if (existingEmail) return res.status(409).json({ error: "Ja existe usuario com este email." }); updates.push("email = ?"); values.push(email);
  }
  const newPassword = payload.novaSenha || payload.newPassword || payload.password || "";
  if (newPassword) { if (newPassword.length < 6) return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres." }); const salt = crypto.randomBytes(16).toString("hex"); updates.push("passwordHash = ?"); values.push(hashPassword(newPassword, salt)); updates.push("passwordSalt = ?"); values.push(salt); await db.run("DELETE FROM user_sessions WHERE userId = ?", target.id); }
  if (req.user.role === "super_admin" && payload.role !== undefined) { updates.push("role = ?"); values.push(normalizeRole(payload.role)); }
  if (req.user.role === "super_admin" && (payload.departmentId !== undefined || payload.departmentName !== undefined || payload.departamento !== undefined)) { const department = await resolveDepartmentByPayload(payload); updates.push("departmentId = ?"); values.push(department?.id || null); }
  if (req.user.role === "super_admin" && payload.active !== undefined) { updates.push("active = ?"); values.push(boolToInt(payload.active)); }
  if (!updates.length) return res.status(400).json({ error: "Nenhum campo valido informado." });
  updates.push("updatedAt = ?"); values.push(new Date().toISOString()); values.push(target.id);
  await db.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, ...values);
  const updated = await db.get("SELECT * FROM users WHERE id = ?", target.id);
  res.json({ user: await serializeUser(await getDb(), updated) });
});

app.delete("/api/users/:id", requireRole("super_admin"), async (req, res) => {
  const db = await getDb();
  const target = await db.get("SELECT * FROM users WHERE id = ?", req.params.id);
  if (!target) return res.status(404).json({ error: "Usuario nao encontrado." });
  if (target.email === MASTER_EMAIL) return res.status(400).json({ error: "Nao e possivel remover o super admin." });
  await db.run("UPDATE projects SET responsibleUserId = NULL, updatedAt = ? WHERE responsibleUserId = ?", new Date().toISOString(), target.id);
  await db.run("DELETE FROM user_sessions WHERE userId = ?", target.id);
  await db.run("DELETE FROM password_reset_tokens WHERE userId = ?", target.id);
  await db.run("DELETE FROM users WHERE id = ?", target.id);
  res.status(204).send();
});
app.get("/api/projects", requireAuth, async (req, res) => {
  const db = await getDb();
  const statement = buildProjectsListQuery(req.user);
  const rows = await db.all(statement.query, ...statement.params);
  res.json(rows.map(serializeProjectRow));
});

app.get("/api/projects/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const row = await loadProjectById(db, req.params.id);
  if (!row || !canAccessProject(req.user, row)) return res.status(404).json({ error: "Projeto nao encontrado." });
  const project = serializeProjectRow(row);
  project.latestRun = await getLatestRun(db, project.id);
  res.json(project);
});

app.post("/api/projects", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const normalized = await buildProjectRecord(db, req.user, req.body || {}, null);
  const errors = validateProjectRecord(normalized);
  if (errors.length) return res.status(400).json({ errors });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.run(`INSERT INTO projects (id, nome, descricao, url, repositorio, status, tecnologias, categoria, screenshot, observacoes, createdByUserId, systemType, responsibleUserId, departmentId, runtimeLanguage, code, scheduleConfig, lastValidationStatus, lastValidationMessage, lastRunStatus, lastRunAt, lastRunOutput, rpaFile, rpaFileName, dataCriacao, dataAtualizacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, normalized.nome, normalized.descricao, normalized.url, normalized.repositorio, normalized.status, JSON.stringify(normalized.tecnologias), normalized.categoria, normalized.screenshot, normalized.observacoes, req.user.id, normalized.systemType, normalized.responsibleUserId, normalized.departmentId, normalized.runtimeLanguage, normalized.code, normalized.scheduleConfig, normalized.lastValidationStatus, normalized.lastValidationMessage, normalized.lastRunStatus, normalized.lastRunAt, normalized.lastRunOutput, normalized.rpaFile, normalized.rpaFileName, now, now);
  const created = await loadProjectById(db, id);
  res.status(201).json(serializeProjectRow(created));
});

app.patch("/api/projects/:id", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const existing = await loadProjectById(db, req.params.id);
  if (!existing) return res.status(404).json({ error: "Projeto nao encontrado." });
  const normalized = await buildProjectRecord(db, req.user, req.body || {}, existing);
  const errors = validateProjectRecord(normalized);
  if (errors.length) return res.status(400).json({ errors });
  await db.run(`UPDATE projects SET nome = ?, descricao = ?, url = ?, repositorio = ?, status = ?, tecnologias = ?, categoria = ?, screenshot = ?, observacoes = ?, systemType = ?, responsibleUserId = ?, departmentId = ?, runtimeLanguage = ?, code = ?, scheduleConfig = ?, lastValidationStatus = ?, lastValidationMessage = ?, lastRunStatus = ?, lastRunAt = ?, lastRunOutput = ?, rpaFile = ?, rpaFileName = ?, dataAtualizacao = ? WHERE id = ?`, normalized.nome, normalized.descricao, normalized.url, normalized.repositorio, normalized.status, JSON.stringify(normalized.tecnologias), normalized.categoria, normalized.screenshot, normalized.observacoes, normalized.systemType, normalized.responsibleUserId, normalized.departmentId, normalized.runtimeLanguage, normalized.code, normalized.scheduleConfig, normalized.lastValidationStatus, normalized.lastValidationMessage, normalized.lastRunStatus, normalized.lastRunAt, normalized.lastRunOutput, normalized.rpaFile, normalized.rpaFileName, new Date().toISOString(), existing.id);
  
  if (req.body.rpaFiles) {
    await saveProjectFiles(db, existing.id, req.body.rpaFiles);
  }

  const updated = await loadProjectById(db, existing.id);
  res.json(serializeProjectRow(updated));
});

app.delete("/api/projects/:id", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const existing = await db.get("SELECT id FROM projects WHERE id = ?", req.params.id);
  if (!existing) return res.status(404).json({ error: "Projeto nao encontrado." });
  await db.run("DELETE FROM projects WHERE id = ?", req.params.id);
  res.status(204).send();
});

app.post("/api/projects/:id/code/test", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const project = await loadProjectById(db, req.params.id);
  if (!project || !canAccessProject(req.user, project)) return res.status(404).json({ error: "Projeto nao encontrado." });
  if (project.systemType !== "rpa") return res.status(400).json({ error: "Codigo esta disponivel apenas para sistemas RPA." });

  const result = await validateRpaCode(project.runtimeLanguage, project.code || "");
  const status = result.exitCode === 0 ? "success" : "error";
  const message = result.message || (result.exitCode === 0 ? "Codigo validado com sucesso." : "Falha na validacao do codigo.");
  await db.run("UPDATE projects SET lastValidationStatus = ?, lastValidationMessage = ?, dataAtualizacao = ? WHERE id = ?", status, message, new Date().toISOString(), project.id);
  const updated = await loadProjectById(db, project.id);
  await createNotificationsForRoles(["super_admin", "admin"], {
    kind: "rpa_validation",
    title: `Validacao RPA: ${project.nome}`,
    body: message,
    targetType: "project",
    targetId: project.id,
    metadata: { status, action: "validate" }
  });
  res.json({ ok: result.exitCode === 0, status, message, stdout: result.stdout || "", stderr: result.stderr || "", project: serializeProjectRow(updated) });
});

app.post("/api/projects/:id/run", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const project = await loadProjectById(db, req.params.id);
  if (!project || !canAccessProject(req.user, project)) return res.status(404).json({ error: "Projeto nao encontrado." });
  if (project.systemType !== "rpa") return res.status(400).json({ error: "Execucao disponivel apenas para sistemas RPA." });
  const triggerType = trimText(req.body?.triggerType) || "manual";
  const triggerValue = trimText(req.body?.triggerValue);
  const result = await executeRpaCode(project.runtimeLanguage, project.code || "", { 
    mode: triggerType === "validate" ? "validate" : "run",
    rpaFiles: project.rpaFiles || [],
    rpaFile: project.rpaFile || ""
  });
  const status = result.exitCode === 0 ? "success" : result.timedOut ? "timeout" : "error";
  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.run(`INSERT INTO project_runs (id, projectId, triggeredByUserId, triggerType, triggerValue, language, status, exitCode, durationMs, stdout, stderr, errorMessage, createdAt, finishedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, runId, project.id, req.user.id, triggerType, triggerValue || "", project.runtimeLanguage, status, Number.isInteger(result.exitCode) ? result.exitCode : null, result.durationMs || null, trimLarge(result.stdout), trimLarge(result.stderr), result.message || result.error || "", createdAt, result.finishedAt || createdAt);
  await db.run("UPDATE projects SET lastRunStatus = ?, lastRunAt = ?, lastRunOutput = ?, dataAtualizacao = ? WHERE id = ?", status, result.finishedAt || createdAt, cleanOutputForDisplay([result.stdout, result.stderr].filter(Boolean).join("\n")), new Date().toISOString(), project.id);
  const updated = await loadProjectById(db, project.id);
  await createNotificationsForRoles(["super_admin", "admin"], {
    kind: "rpa_execution",
    title: `${actionLabelFromTrigger(triggerType)} RPA: ${project.nome}`,
    body: result.message || result.stdout || result.stderr || `Execucao finalizada com status ${status}.`,
    targetType: "project",
    targetId: project.id,
    metadata: { status, triggerType }
  });
  res.json({ ok: result.exitCode === 0, status, stdout: result.stdout || "", stderr: result.stderr || "", message: result.message || "", project: serializeProjectRow(updated) });
});

// Endpoint SSE — streaming de progresso em tempo real durante execução do RPA
// O cliente abre GET /api/projects/:id/run/stream?triggerType=manual
// e recebe eventos SSE enquanto o RPA executa.
app.get("/api/projects/:id/run/stream", requireRole("super_admin", "admin"), async (req, res) => {
  const db = await getDb();
  const project = await loadProjectById(db, req.params.id);
  if (!project || !canAccessProject(req.user, project)) return res.status(404).json({ error: "Projeto nao encontrado." });
  if (project.systemType !== "rpa") return res.status(400).json({ error: "Execucao disponivel apenas para sistemas RPA." });

  const triggerType = trimText(req.query?.triggerType) || "manual";
  const triggerValue = trimText(req.query?.triggerValue);

  // Configura SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // desativa buffer do nginx
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent("start", { projectId: project.id, projectName: project.nome, ts: new Date().toISOString() });

  let result;
  try {
    result = await executeRpaCode(project.runtimeLanguage, project.code || "", {
      mode: triggerType === "validate" ? "validate" : "run",
      rpaFiles: project.rpaFiles || [],
      rpaFile: project.rpaFile || "",
      onProgress: (logEntry) => {
        // Repassa cada linha JSON do script para o cliente via SSE
        sendEvent("progress", logEntry);
      },
    });
  } catch (err) {
    sendEvent("error", { message: err.message });
    res.end();
    return;
  }

  const status = result.exitCode === 0 ? "success" : result.timedOut ? "timeout" : "error";
  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db.run(
    `INSERT INTO project_runs (id, projectId, triggeredByUserId, triggerType, triggerValue, language, status, exitCode, durationMs, stdout, stderr, errorMessage, createdAt, finishedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId, project.id, req.user.id, triggerType, triggerValue || "", project.runtimeLanguage,
    status, Number.isInteger(result.exitCode) ? result.exitCode : null,
    result.durationMs || null, trimLarge(result.stdout), trimLarge(result.stderr),
    result.message || result.error || "", createdAt, result.finishedAt || createdAt
  );
  await db.run(
    "UPDATE projects SET lastRunStatus = ?, lastRunAt = ?, lastRunOutput = ?, dataAtualizacao = ? WHERE id = ?",
    status, result.finishedAt || createdAt,
    cleanOutputForDisplay([result.stdout, result.stderr].filter(Boolean).join("\n")),
    new Date().toISOString(), project.id
  );

  await createNotificationsForRoles(["super_admin", "admin"], {
    kind: "rpa_execution",
    title: `${actionLabelFromTrigger(triggerType)} RPA: ${project.nome}`,
    body: result.message || result.stdout || result.stderr || `Execucao finalizada com status ${status}.`,
    targetType: "project",
    targetId: project.id,
    metadata: { status, triggerType }
  });

  const updated = await loadProjectById(db, project.id);
  sendEvent("done", {
    ok: result.exitCode === 0,
    status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    message: result.message || "",
    durationMs: result.durationMs || 0,
    project: serializeProjectRow(updated),
  });

  res.end();
});

app.get("/api/projects/:id/runs", requireAuth, async (req, res) => {
  const db = await getDb();
  const project = await loadProjectById(db, req.params.id);
  if (!project || !canAccessProject(req.user, project)) return res.status(404).json({ error: "Projeto nao encontrado." });
  const rows = await db.all("SELECT * FROM project_runs WHERE projectId = ? ORDER BY datetime(createdAt) DESC LIMIT 50", project.id);
  res.json(rows);
});

app.get("/api/tickets", requireAuth, async (req, res) => {
  const db = await getDb();
  const filters = buildTicketFilters(req.user, req.query || {});
  const rows = await db.all(
    `SELECT t.*,
            COALESCE(requester.nome, t.requesterName) AS requesterName,
            COALESCE(requester.email, t.requesterEmail) AS requesterEmail,
            assigned.nome AS assignedName,
            assigned.email AS assignedEmail,
            d.nome AS departmentName,
            p.nome AS projectName,
            (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticketId = t.id) AS messageCount
     FROM tickets t
     LEFT JOIN users requester ON requester.id = t.requesterUserId
     LEFT JOIN users assigned ON assigned.id = t.assignedUserId
     LEFT JOIN departments d ON d.id = t.departmentId
     LEFT JOIN projects p ON p.id = t.projectId
     WHERE ${filters.where}
     ORDER BY datetime(t.updatedAt) DESC, t.number DESC`,
    ...filters.params
  );
  res.json(rows.map(serializeTicketRow));
});

app.get("/api/tickets/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const ticket = await loadTicketById(db, req.params.id);
  if (!ticket || !canAccessTicket(req.user, ticket)) return res.status(404).json({ error: "Chamado nao encontrado." });
  const messages = await loadTicketMessages(db, ticket.id, req.user);
  res.json({ ticket: serializeTicketRow(ticket), messages });
});

app.post("/api/tickets", requireAuth, async (req, res) => {
  const db = await getDb();
  const payload = req.body || {};
  const titulo = trimText(payload.titulo);
  const descricao = trimText(payload.descricao);
  if (!titulo || !descricao) return res.status(400).json({ error: "Titulo e descricao sao obrigatorios." });

  const category = normalizeTicketCategory(payload.categoria);
  const priority = normalizeTicketPriority(payload.prioridade);
  const department = await resolveDepartmentByPayload(payload);
  const project = await resolveTicketProject(payload.projectId);
  if (project && !canAccessProject(req.user, project)) return res.status(403).json({ error: "Projeto informado nao pertence ao seu escopo." });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const nextNumberRow = await db.get("SELECT COALESCE(MAX(number), 0) + 1 AS nextNumber FROM tickets");
  const number = nextNumberRow?.nextNumber || 1;

  await db.run(
    `INSERT INTO tickets
      (id, number, titulo, descricao, categoria, prioridade, status, requesterUserId, requesterName, requesterEmail, assignedUserId, departmentId, projectId, systemType, resolutionSummary, resolvedAt, closedAt, lastRequesterReplyAt, lastAgentReplyAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'aberto', ?, ?, ?, NULL, ?, ?, ?, '', NULL, NULL, ?, NULL, ?, ?)`,
    id,
    number,
    titulo,
    descricao,
    category,
    priority,
    req.user.id,
    req.user.nome || req.user.email,
    req.user.email,
    department?.id || req.user.departmentId || null,
    project?.id || null,
    trimText(payload.systemType) || "common",
    now,
    now,
    now
  );

  await db.run(
    `INSERT INTO ticket_messages
      (id, ticketId, authorUserId, authorName, authorEmail, authorRole, visibility, messageType, body, fromStatus, toStatus, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'public', 'message', ?, NULL, 'aberto', ?)`,
    crypto.randomUUID(),
    id,
    req.user.id,
    req.user.nome || req.user.email,
    req.user.email,
    req.user.role || "user",
    descricao,
    now
  );

  const created = await loadTicketById(db, id);
  await createNotificationsForRoles(["super_admin", "admin"], {
    kind: "ticket_created",
    title: `Novo ticket #${number}`,
    body: `${req.user.nome || req.user.email} abriu: ${titulo}`,
    targetType: "ticket",
    targetId: id,
    metadata: { category, priority }
  }, [req.user.id]);
  res.status(201).json({ ticket: serializeTicketRow(created) });
});

app.patch("/api/tickets/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const existing = await loadTicketById(db, req.params.id);
  if (!existing || !canAccessTicket(req.user, existing)) return res.status(404).json({ error: "Chamado nao encontrado." });

  const actorType = getTicketActorType(req.user);
  const payload = req.body || {};
  const updates = [];
  const values = [];
  let nextStatus = existing.status;
  let resolutionSummary = existing.resolutionSummary || "";

  if (payload.status !== undefined) {
    nextStatus = normalizeTicketStatus(payload.status);
    const allowed = getAllowedTicketStatuses(existing.status, actorType);
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: "Transicao de status invalida para este perfil." });
    }
    updates.push("status = ?");
    values.push(nextStatus);
  }

  if (payload.prioridade !== undefined) {
    if (actorType === "requester") return res.status(403).json({ error: "Usuario nao pode alterar prioridade." });
    updates.push("prioridade = ?");
    values.push(normalizeTicketPriority(payload.prioridade));
  }

  if (payload.categoria !== undefined) {
    if (actorType === "requester") return res.status(403).json({ error: "Usuario nao pode alterar categoria." });
    updates.push("categoria = ?");
    values.push(normalizeTicketCategory(payload.categoria));
  }

  if (payload.assignedUserId !== undefined) {
    if (actorType === "requester") return res.status(403).json({ error: "Usuario nao pode alterar responsavel." });
    let assignedUser;
    try {
      assignedUser = await resolveAssignableTicketUser(payload.assignedUserId);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Responsavel invalido para o chamado." });
    }
    updates.push("assignedUserId = ?");
    values.push(assignedUser?.id || null);
  }

  if (payload.departmentId !== undefined || payload.departamento !== undefined || payload.department !== undefined) {
    if (actorType === "requester") return res.status(403).json({ error: "Usuario nao pode alterar departamento." });
    const department = await resolveDepartmentByPayload(payload);
    updates.push("departmentId = ?");
    values.push(department?.id || null);
  }

  if (payload.projectId !== undefined) {
    if (actorType === "requester") return res.status(403).json({ error: "Usuario nao pode alterar projeto vinculado." });
    const project = await resolveTicketProject(payload.projectId);
    updates.push("projectId = ?");
    values.push(project?.id || null);
  }

  if (payload.resolutionSummary !== undefined) {
    if (actorType === "requester") return res.status(403).json({ error: "Usuario nao pode definir tratativa final." });
    resolutionSummary = trimLarge(payload.resolutionSummary);
    updates.push("resolutionSummary = ?");
    values.push(resolutionSummary);
  }

  // Removido o bloqueio estrito de resolutionSummary para admins, 
  // permitindo que usem o sistema de mensagens para documentar a solucao.
  if (
    actorType === "agent"
    && ["resolvido", "encerrado"].includes(nextStatus)
    && !trimText(resolutionSummary)
    && !trimText(payload.note)
  ) {
    // Se nao tem resumo nem nota, avisa, mas vamos permitir se houver mensagem vindo do outro fluxo
  }

  if (!updates.length) return res.status(400).json({ error: "Nenhuma alteracao valida informada." });

  const now = new Date().toISOString();
  if (payload.status !== undefined && nextStatus !== existing.status) {
    if (nextStatus === "resolvido") {
      updates.push("resolvedAt = ?");
      values.push(now);
    }
    if (nextStatus === "encerrado") {
      updates.push("closedAt = ?");
      values.push(now);
      // Se nao estava resolvido antes, marca como resolvido agora tambem
      if (!existing.resolvedAt) {
        updates.push("resolvedAt = ?");
        values.push(now);
      }
    }
  }
  updates.push("updatedAt = ?");
  values.push(now);
  values.push(existing.id);

  await db.run(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`, ...values);

  const note = trimText(payload.note || payload.mensagem || payload.comentario);
  if (note || payload.status !== undefined || payload.resolutionSummary !== undefined) {
    await db.run(
      `INSERT INTO ticket_messages
        (id, ticketId, authorUserId, authorName, authorEmail, authorRole, visibility, messageType, body, fromStatus, toStatus, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      existing.id,
      req.user.id,
      req.user.nome || req.user.email,
      req.user.email,
      req.user.role || "user",
      payload.status !== undefined ? "status_change" : "message",
      trimLarge(note || resolutionSummary || `Status alterado para ${formatTicketStatus(nextStatus)}.`),
      existing.status,
      payload.status !== undefined ? nextStatus : existing.status,
      now
    );
  }

  const updated = await loadTicketById(db, existing.id);
  const messages = await loadTicketMessages(db, existing.id, req.user);
  await notifyTicketParticipants(updated, req.user, {
    kind: "ticket_updated",
    title: `Ticket #${updated.number} atualizado`,
    body: payload.status !== undefined
      ? `Status alterado para ${formatTicketStatus(nextStatus)}.`
      : `Tratativa atualizada por ${req.user.nome || req.user.email}.`
  });
  res.json({ ticket: serializeTicketRow(updated), messages });
});

app.post("/api/tickets/:id/messages", requireAuth, async (req, res) => {
  const db = await getDb();
  const ticket = await loadTicketById(db, req.params.id);
  if (!ticket || !canAccessTicket(req.user, ticket)) return res.status(404).json({ error: "Chamado nao encontrado." });

  const body = trimText(req.body?.body || req.body?.message);
  if (!body) return res.status(400).json({ error: "Mensagem obrigatoria." });

  const actorType = getTicketActorType(req.user);
  let nextStatus = normalizeTicketStatus(req.body?.status || ticket.status);
  
  // Valida transicao se status for diferente do atual
  if (nextStatus !== ticket.status) {
    const allowed = getAllowedTicketStatuses(ticket.status, actorType);
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: `Transicao de status de ${ticket.status} para ${nextStatus} nao permitida.` });
    }
  } else {
    // Logica automatica de status
    if (actorType === "requester" && ["aguardando_resposta_usuario", "resolvido"].includes(ticket.status)) {
      nextStatus = "em_tratamento";
    } else if (actorType !== "requester" && ticket.status === "aberto") {
      nextStatus = "em_tratamento";
    }
  }

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO ticket_messages
      (id, ticketId, authorUserId, authorName, authorEmail, authorRole, visibility, messageType, body, fromStatus, toStatus, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'public', 'message', ?, ?, ?, ?)`,
    crypto.randomUUID(),
    ticket.id,
    req.user.id,
    req.user.nome || req.user.email,
    req.user.email,
    req.user.role || "user",
    trimLarge(body),
    ticket.status,
    nextStatus,
    now
  );

  const updates = ["updatedAt = ?"];
  const values = [now];
  if (nextStatus !== ticket.status) {
    updates.push("status = ?");
    values.push(nextStatus);
    
    if (nextStatus === "resolvido") {
      updates.push("resolvedAt = ?");
      values.push(now);
    } else if (nextStatus === "encerrado") {
      updates.push("closedAt = ?");
      values.push(now);
      if (!ticket.resolvedAt) {
        updates.push("resolvedAt = ?");
        values.push(now);
      }
    }
  }
  if (actorType === "requester") {
    updates.push("lastRequesterReplyAt = ?");
    values.push(now);
  } else {
    updates.push("lastAgentReplyAt = ?");
    values.push(now);
    if (!ticket.assignedUserId) {
      updates.push("assignedUserId = ?");
      values.push(req.user.id);
    }
  }
  values.push(ticket.id);
  await db.run(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`, ...values);

  const updated = await loadTicketById(db, ticket.id);
  const messages = await loadTicketMessages(db, ticket.id, req.user);
  await notifyTicketParticipants(updated, req.user, {
    kind: "ticket_message",
    title: `Nova interacao no ticket #${updated.number}`,
    body: trimLarge(body)
  });
  res.status(201).json({ ticket: serializeTicketRow(updated), messages });
});
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error?.code === "SQLITE_CONSTRAINT") {
    const message = String(error.message || "");
    if (message.includes("users.email")) {
      return res.status(409).json({ error: "Ja existe usuario com este email." });
    }
    if (message.includes("departments.nome")) {
      return res.status(409).json({ error: "Ja existe departamento com este nome." });
    }
    return res.status(409).json({ error: "Violacao de integridade no banco de dados." });
  }

  return res.status(500).json({ error: "Erro interno do servidor." });
});

await initDb();
startScheduler();
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});

async function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: "Nao autenticado." });
  const db = await getDb();
  const tokenHash = hashToken(token);
  const session = await db.get("SELECT * FROM user_sessions WHERE tokenHash = ? AND expiresAt > ?", tokenHash, new Date().toISOString());
  if (!session) return res.status(401).json({ error: "Sessao invalida." });
  const user = await db.get("SELECT * FROM users WHERE id = ?", session.userId);
  if (!user) return res.status(401).json({ error: "Usuario invalido." });
  req.user = user; req.tokenHash = tokenHash; next();
}

function requireRole(...roles) { return async (req, res, next) => { await requireAuth(req, res, async () => { if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Sem permissao para esta acao." }); next(); }); }; }
function getTokenFromRequest(req) { const authorization = req.headers.authorization || ""; return authorization.startsWith("Bearer ") ? authorization.replace("Bearer ", "").trim() : null; }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString("hex"); }
function safeEqual(a, b) { const left = Buffer.from(a, "hex"); const right = Buffer.from(b, "hex"); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function trimText(value) { return String(value || "").trim(); }
function boolToInt(value) { return value ? 1 : 0; }
function normalizeRole(role) { const value = trimText(role).toLowerCase(); return VALID_ROLES.includes(value) ? value : "user"; }
function normalizeTicketCategory(value) { const category = trimText(value).toLowerCase(); return VALID_TICKET_CATEGORIES.includes(category) ? category : "outro"; }
function normalizeTicketPriority(value) { const priority = trimText(value).toLowerCase(); return VALID_TICKET_PRIORITIES.includes(priority) ? priority : "media"; }
function normalizeTicketStatus(value) { const status = trimText(value).toLowerCase(); return VALID_TICKET_STATUSES.includes(status) ? status : "aberto"; }
function trimLarge(value) { return String(value || "").slice(0, 12000); }

/**
 * Converte stdout bruto (que pode conter JSON estruturado com screenshots)
 * em texto limpo e legível para exibição no card e no banco.
 * Remove linhas de screenshot (base64) e extrai apenas as mensagens de texto.
 */
function cleanOutputForDisplay(rawOutput) {
  const text = String(rawOutput || "");
  const lines = text.split("\n");
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      // Ignora eventos de screenshot (contêm base64 enorme)
      if (parsed.level === "screenshot") continue;
      // Extrai só a mensagem do JSON estruturado
      if (parsed.message) {
        cleaned.push(parsed.message);
      }
    } catch {
      // Linha de texto puro — mantém como está
      cleaned.push(trimmed);
    }
  }
  return cleaned.join("\n").slice(0, 2000);
}
function parseJson(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function serializeDepartmentRow(row) { return { id: row.id, nome: row.nome, descricao: row.descricao || "", ativo: Boolean(row.ativo ?? 1) }; }
function serializeUserRow(row) { return { id: row.id, nome: row.nome, email: row.email, role: row.role || "user", active: Boolean(row.active ?? 1), departamento: row.department__nome || "", departmentId: row.departmentId || row.department__id || null, foto: row.foto || "", createdAt: row.createdAt, updatedAt: row.updatedAt, lastLoginAt: row.lastLoginAt || null }; }
async function serializeUser(db, row) { const full = await db.get(`SELECT u.*, d.id AS department__id, d.nome AS department__nome FROM users u LEFT JOIN departments d ON d.id = u.departmentId WHERE u.id = ?`, row.id); return serializeUserRow(full); }
function serializeProjectRow(row) { 
  const schedule = parseJson(row.scheduleConfig, {}); 
  return { 
    id: row.id, 
    nome: row.nome, 
    descricao: row.descricao, 
    url: row.url, 
    repositorio: row.repositorio || "", 
    status: row.status, 
    tecnologias: parseJson(row.tecnologias, []), 
    categoria: row.categoria, 
    screenshot: row.screenshot || "", 
    observacoes: row.observacoes || "", 
    systemType: row.systemType || "common", 
    ownerEmail: row.ownerEmail || "", 
    ownerName: row.ownerName || "", 
    department: row.departmentName || "", 
    language: normalizeLanguage(row.runtimeLanguage || "") || "javascript", 
    code: row.code || "", 
    scheduleMode: schedule.mode || "manual", 
    scheduleHours: Array.isArray(schedule.hours) ? schedule.hours.join(", ") : "", 
    scheduleDates: Array.isArray(schedule.dates) ? schedule.dates.join(", ") : "", 
    lastValidationStatus: row.lastValidationStatus || "", 
    lastValidationMessage: row.lastValidationMessage || "", 
    lastRunStatus: row.lastRunStatus || "", 
    lastRunAt: row.lastRunAt || null, 
    lastRunOutput: row.lastRunOutput || "", 
    rpaFile: row.rpaFile || "", 
    rpaFileName: row.rpaFileName || "",
    rpaFiles: (row.rpaFiles || []).map(f => ({ id: f.id, fileName: f.fileName, fileContent: f.fileContent, fileSize: f.fileSize }))
  }; 
}
function serializeNotificationRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    targetType: row.targetType || "",
    targetId: row.targetId || "",
    metadata: parseJson(row.metadata, {}),
    readAt: row.readAt || null,
    createdAt: row.createdAt
  };
}
function serializeTicketRow(row) {
  return {
    id: row.id,
    number: row.number,
    titulo: row.titulo,
    descricao: row.descricao,
    categoria: normalizeTicketCategory(row.categoria),
    prioridade: normalizeTicketPriority(row.prioridade),
    status: normalizeTicketStatus(row.status),
    requesterUserId: row.requesterUserId,
    requesterName: row.requesterName || "",
    requesterEmail: row.requesterEmail || "",
    assignedUserId: row.assignedUserId || null,
    assignedName: row.assignedName || "",
    assignedEmail: row.assignedEmail || "",
    departmentId: row.departmentId || null,
    departmentName: row.departmentName || "",
    projectId: row.projectId || null,
    projectName: row.projectName || "",
    systemType: row.systemType || "common",
    resolutionSummary: row.resolutionSummary || "",
    resolvedAt: row.resolvedAt || null,
    closedAt: row.closedAt || null,
    lastRequesterReplyAt: row.lastRequesterReplyAt || null,
    lastAgentReplyAt: row.lastAgentReplyAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount: Number(row.messageCount || 0)
  };
}
function serializeTicketMessageRow(row) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorUserId: row.authorUserId || null,
    authorName: row.authorName || "",
    authorEmail: row.authorEmail || "",
    authorRole: row.authorRole || "user",
    visibility: row.visibility || "public",
    messageType: row.messageType || "message",
    body: row.body || "",
    fromStatus: row.fromStatus || null,
    toStatus: row.toStatus || null,
    createdAt: row.createdAt
  };
}
function buildProjectsListQuery(user) { return { query: `SELECT p.*, u.email AS ownerEmail, u.nome AS ownerName, d.nome AS departmentName FROM projects p LEFT JOIN users u ON u.id = p.responsibleUserId LEFT JOIN departments d ON d.id = p.departmentId WHERE (${user.role === "user" ? "p.responsibleUserId = ?" : "1 = 1"}) ORDER BY datetime(p.dataAtualizacao) DESC`, params: user.role === "user" ? [user.id] : [] }; }
function canAccessProject(user, project) { return user.role !== "user" || project.responsibleUserId === user.id; }
async function loadProjectById(db, id) { 
  const row = await db.get(`SELECT p.*, u.email AS ownerEmail, u.nome AS ownerName, d.nome AS departmentName FROM projects p LEFT JOIN users u ON u.id = p.responsibleUserId LEFT JOIN departments d ON d.id = p.departmentId WHERE p.id = ?`, id); 
  if (row) {
    row.rpaFiles = await db.all("SELECT * FROM project_files WHERE projectId = ?", id);
  }
  return row;
}

async function saveProjectFiles(db, projectId, files) {
  // Simplificacao: remove todos e insere novamente
  await db.run("DELETE FROM project_files WHERE projectId = ?", projectId);
  const now = new Date().toISOString();
  for (const file of files) {
    if (!file.fileContent) continue;
    await db.run(
      "INSERT INTO project_files (id, projectId, fileName, fileContent, fileSize, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      file.id || crypto.randomUUID(),
      projectId,
      file.fileName,
      file.fileContent,
      file.fileSize || 0,
      now
    );
  }
}

async function getLatestRun(db, projectId) { return db.get("SELECT * FROM project_runs WHERE projectId = ? ORDER BY datetime(createdAt) DESC LIMIT 1", projectId); }
function buildTicketFilters(user, query) {
  const where = [];
  const params = [];
  if (user.role === "user") {
    where.push("t.requesterUserId = ?");
    params.push(user.id);
  }
  const rawStatus = trimText(query?.status).toLowerCase();
  const status = normalizeTicketStatus(rawStatus);
  if (rawStatus && rawStatus !== "all") {
    where.push("t.status = ?");
    params.push(status);
  }
  const rawCategory = trimText(query?.categoria || query?.category).toLowerCase();
  const category = normalizeTicketCategory(rawCategory);
  if (rawCategory && rawCategory !== "all") {
    where.push("t.categoria = ?");
    params.push(category);
  }
  const search = trimText(query?.search || query?.q);
  if (search) {
    where.push("(LOWER(t.titulo) LIKE ? OR LOWER(t.descricao) LIKE ? OR CAST(t.number AS TEXT) LIKE ?)");
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`, `%${search}%`);
  }
  const systemType = trimText(query?.systemType).toLowerCase();
  if (systemType && systemType !== "all") {
    where.push("t.systemType = ?");
    params.push(systemType);
  }
  return { where: where.length ? where.join(" AND ") : "1 = 1", params };
}
function canAccessTicket(user, ticket) {
  return user.role !== "user" || ticket.requesterUserId === user.id;
}
function getTicketActorType(user) {
  return user.role === "user" ? "requester" : "agent";
}
function getAllowedTicketStatuses(currentStatus, actorType) {
  if (currentStatus === "encerrado") return [];
  if (actorType === "requester") {
    if (currentStatus === "resolvido") return ["encerrado", "em_tratamento"];
    return ["em_tratamento"];
  }
  const transitions = {
    aberto: ["aberto", "em_tratamento", "aguardando_resposta_usuario", "resolvido", "encerrado"],
    em_tratamento: ["em_tratamento", "aguardando_resposta_usuario", "resolvido", "encerrado"],
    aguardando_resposta_usuario: ["em_tratamento", "aguardando_resposta_usuario", "resolvido", "encerrado"],
    resolvido: ["em_tratamento", "resolvido", "encerrado"]
  };
  return transitions[currentStatus] || [];
}
function formatTicketStatus(status) {
  return {
    aberto: "Aberto",
    em_tratamento: "Em tratamento",
    aguardando_resposta_usuario: "Aguardando resposta do usuario",
    resolvido: "Resolvido",
    encerrado: "Encerrado"
  }[normalizeTicketStatus(status)] || "Aberto";
}
async function loadTicketById(db, id) {
  return db.get(
    `SELECT t.*,
            COALESCE(requester.nome, t.requesterName) AS requesterName,
            COALESCE(requester.email, t.requesterEmail) AS requesterEmail,
            assigned.nome AS assignedName,
            assigned.email AS assignedEmail,
            d.nome AS departmentName,
            p.nome AS projectName,
            (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticketId = t.id) AS messageCount
     FROM tickets t
     LEFT JOIN users requester ON requester.id = t.requesterUserId
     LEFT JOIN users assigned ON assigned.id = t.assignedUserId
     LEFT JOIN departments d ON d.id = t.departmentId
     LEFT JOIN projects p ON p.id = t.projectId
     WHERE t.id = ?`,
    id
  );
}
async function loadTicketMessages(db, ticketId, actor) {
  const rows = await db.all(
    `SELECT tm.*,
            COALESCE(u.nome, tm.authorName) AS authorName,
            COALESCE(u.email, tm.authorEmail) AS authorEmail,
            COALESCE(u.role, tm.authorRole) AS authorRole
     FROM ticket_messages tm
     LEFT JOIN users u ON u.id = tm.authorUserId
     WHERE tm.ticketId = ? AND (? <> 'user' OR tm.visibility = 'public')
     ORDER BY datetime(tm.createdAt) ASC`,
    ticketId,
    actor.role
  );
  return rows.map(serializeTicketMessageRow);
}
async function resolveTicketProject(projectId) {
  const id = trimText(projectId);
  if (!id) return null;
  const db = await getDb();
  return db.get("SELECT * FROM projects WHERE id = ?", id);
}
async function resolveAssignableTicketUser(userId) {
  const id = trimText(userId);
  if (!id) return null;
  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE id = ?", id);
  if (!user) throw new Error("Usuario responsavel nao encontrado.");
  if (!["super_admin", "admin"].includes(user.role)) throw new Error("Responsavel do chamado precisa ser admin ou super admin.");
  return user;
}
function actionLabelFromTrigger(triggerType) {
  return triggerType === "test" ? "Teste" : triggerType === "manual" ? "Execucao" : "Execucao";
}
async function createNotifications(recipientIds, payload) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length) return;
  const db = await getDb();
  const now = new Date().toISOString();
  for (const recipientUserId of ids) {
    await db.run(
      `INSERT INTO notifications
        (id, recipientUserId, kind, title, body, targetType, targetId, metadata, readAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      crypto.randomUUID(),
      recipientUserId,
      payload.kind || "info",
      trimLarge(payload.title || "Atualizacao"),
      trimLarge(payload.body || ""),
      payload.targetType || "",
      payload.targetId || "",
      JSON.stringify(payload.metadata || {}),
      now
    );
  }
}
async function createNotificationsForRoles(roles, payload, excludeUserIds = []) {
  const db = await getDb();
  const placeholders = roles.map(() => "?").join(", ");
  const rows = await db.all(`SELECT id FROM users WHERE active = 1 AND role IN (${placeholders})`, ...roles);
  const recipients = rows.map((row) => row.id).filter((id) => !excludeUserIds.includes(id));
  await createNotifications(recipients, payload);
}
async function notifyTicketParticipants(ticket, actor, payload) {
  const recipientIds = [];
  if (actor.role === "user") {
    if (ticket.assignedUserId) {
      recipientIds.push(ticket.assignedUserId);
    } else {
      const db = await getDb();
      const admins = await db.all("SELECT id FROM users WHERE active = 1 AND role IN ('super_admin', 'admin')");
      recipientIds.push(...admins.map((row) => row.id));
    }
  } else if (ticket.requesterUserId) {
    recipientIds.push(ticket.requesterUserId);
  }
  await createNotifications(recipientIds.filter((id) => id !== actor.id), {
    ...payload,
    targetType: "ticket",
    targetId: ticket.id,
    metadata: { number: ticket.number, status: ticket.status }
  });
}
async function resolveDepartmentByPayload(payload) { const name = trimText(payload?.departmentName || payload?.departamento || payload?.department); const id = trimText(payload?.departmentId); const db = await getDb(); if (id) { const row = await db.get("SELECT * FROM departments WHERE id = ?", id); if (row) return row; if (!name) return null; } if (!name) return null; let row = await db.get("SELECT * FROM departments WHERE nome = ?", name); if (row) return row; const now = new Date().toISOString(); const newId = crypto.randomUUID(); await db.run("INSERT INTO departments (id, nome, descricao, ativo, createdByUserId, createdAt, updatedAt) VALUES (?, ?, '', 1, NULL, ?, ?)", newId, name, now, now); return db.get("SELECT * FROM departments WHERE id = ?", newId); }
async function buildProjectRecord(db, actor, payload, existing) { 
  const normalizedRpa = normalizeRpaProjectPayload(payload); 
  const ownerEmail = normalizeEmail(payload.ownerEmail || existing?.ownerEmail); 
  const owner = ownerEmail ? await db.get("SELECT * FROM users WHERE email = ?", ownerEmail) : null; 
  const department = await resolveDepartmentByPayload({ departmentId: payload.departmentId || existing?.departmentId, department: payload.department || existing?.departmentName }); 
  const technologies = Array.isArray(payload.tecnologias) ? payload.tecnologias : String(payload.tecnologias || existing?.tecnologias || "").split(",").map((item) => item.trim()).filter(Boolean); 
  
  return { 
    nome: payload.nome !== undefined ? trimText(payload.nome) : (existing?.nome || ""), 
    descricao: payload.descricao !== undefined ? trimText(payload.descricao) : (existing?.descricao || ""), 
    url: payload.url !== undefined ? trimText(payload.url) : (existing?.url || ""), 
    repositorio: payload.repositorio !== undefined ? trimText(payload.repositorio) : (existing?.repositorio || ""), 
    status: payload.status !== undefined ? trimText(payload.status) : (existing?.status || "ativo"), 
    tecnologias: technologies, 
    categoria: payload.categoria !== undefined ? trimText(payload.categoria) : (existing?.categoria || "interno"), 
    screenshot: payload.screenshot !== undefined ? trimText(payload.screenshot) : (existing?.screenshot || ""), 
    observacoes: payload.observacoes !== undefined ? trimText(payload.observacoes) : (existing?.observacoes || ""), 
    systemType: normalizedRpa.systemType, 
    responsibleUserId: owner?.id || null, 
    departmentId: department?.id || null, 
    runtimeLanguage: normalizedRpa.language || "", 
    code: normalizedRpa.code || "", 
    scheduleConfig: JSON.stringify({ mode: normalizedRpa.scheduleMode, hours: normalizeScheduleValues(normalizedRpa.scheduleHours), dates: normalizeScheduleValues(normalizedRpa.scheduleDates), notes: normalizedRpa.scheduleNotes || "" }), 
    lastValidationStatus: existing?.lastValidationStatus || "", 
    lastValidationMessage: existing?.lastValidationMessage || "", 
    lastRunStatus: existing?.lastRunStatus || "", 
    lastRunAt: existing?.lastRunAt || null, 
    lastRunOutput: existing?.lastRunOutput || "", 
    rpaFile: payload.rpaFile !== undefined ? normalizedRpa.rpaFile : (existing?.rpaFile || ""), 
    rpaFileName: payload.rpaFileName !== undefined ? normalizedRpa.rpaFileName : (existing?.rpaFileName || "") 
  }; 
}
function validateProjectRecord(project) { const errors = []; if (!project.nome) errors.push("nome"); if (!project.descricao) errors.push("descricao"); if (!project.url) errors.push("url"); if (!project.status) errors.push("status"); if (!project.categoria) errors.push("categoria"); if (!Array.isArray(project.tecnologias) || !project.tecnologias.length) errors.push("tecnologias"); if (!project.responsibleUserId) errors.push("ownerEmail"); if (project.systemType === "rpa") { if (!project.runtimeLanguage) errors.push("language"); if (!trimText(project.code)) errors.push("code"); } return errors; }
function buildResetLink(req, token) { const frontendBase = process.env.FRONTEND_URL?.trim() || `${req.protocol}://${req.get("host")}`; return `${frontendBase}${frontendBase.includes("?") ? "&" : "?"}resetToken=${encodeURIComponent(token)}`; }
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  mailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: MAIL_USER,
      pass: MAIL_APP_PASSWORD
    }
  });
  return mailTransporter;
}

async function sendResetCodeEmail({ to, name, code }) {
  const transporter = getMailTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    from: `"Gestao Unimed" <${MAIL_FROM}>`,
    to,
    subject: `Codigo de Recuperacao: ${code}`,
    text: [
      `Ola, ${name || "usuario"}.`,
      "",
      "Seu codigo para recuperar a senha e:",
      "",
      `   ${code}`,
      "",
      "Este codigo e valido por 10 minutos.",
      "Se voce nao solicitou a troca de senha, por favor ignore este email.",
      "",
      "Atenciosamente,",
      "Equipe Gestao Unimed"
    ].join("\n")
  });
  return true;
}
function startScheduler() { if (schedulerStarted) return; schedulerStarted = true; setInterval(() => runSchedules().catch((error) => console.error("Falha no scheduler:", error)), 60000); }
async function runSchedules() { const db = await getDb(); const rows = await db.all("SELECT * FROM projects WHERE systemType = 'rpa' AND scheduleConfig IS NOT NULL"); const now = new Date(); for (const project of rows) { const schedule = parseJson(project.scheduleConfig, {}); const hours = Array.isArray(schedule.hours) ? schedule.hours : []; const dates = Array.isArray(schedule.dates) ? schedule.dates : []; const currentHour = now.toTimeString().slice(0, 5); const currentDate = now.toISOString().slice(0, 10); const trigger = hours.includes(currentHour) ? currentHour : dates.includes(currentDate) ? currentDate : ""; if (!trigger) continue; if (project.lastRunAt && String(project.lastRunAt).startsWith(currentDate) && project.lastRunOutput?.includes(`schedule:${trigger}`)) continue; const result = await executeRpaCode(project.runtimeLanguage, project.code || "", { rpaFile: project.rpaFile || "" }).catch((error) => ({ exitCode: 1, stdout: "", stderr: error.message, message: error.message })); const status = result.exitCode === 0 ? "success" : "error"; const runId = crypto.randomUUID(); const finishedAt = result.finishedAt || new Date().toISOString(); await db.run(`INSERT INTO project_runs (id, projectId, triggeredByUserId, triggerType, triggerValue, language, status, exitCode, durationMs, stdout, stderr, errorMessage, createdAt, finishedAt) VALUES (?, ?, NULL, 'schedule', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, runId, project.id, trigger, project.runtimeLanguage, status, Number.isInteger(result.exitCode) ? result.exitCode : null, result.durationMs || null, trimLarge(result.stdout), trimLarge(result.stderr), result.message || result.error || "", finishedAt, finishedAt); await db.run("UPDATE projects SET lastRunStatus = ?, lastRunAt = ?, lastRunOutput = ?, dataAtualizacao = ? WHERE id = ?", status, finishedAt, trimLarge(`schedule:${trigger}\n${result.stdout || result.stderr || ''}`), finishedAt, project.id); } }
