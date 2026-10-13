import crypto from "node:crypto";
import { getDb } from "../db.js";
import { requireAuth, requireManager, requireRole, ROLES } from "../lib/auth.js";
import { resolveDepartment } from "../lib/departments.js";
import {
  asyncRouter, badRequest, conflict, forbidden, isValidEmail, normalizeEmail, notFound, nowIso, trimText
} from "../lib/http.js";
import { createPasswordHash, validatePasswordPolicy, verifyPassword } from "../lib/security.js";
import { loadUser, serializeUser, USER_SELECT } from "../lib/users.js";

const router = asyncRouter();
const MAX_PHOTO_CHARS = 1_500_000;

function normalizeRole(value) {
  const role = trimText(value).toLowerCase();
  return ROLES.includes(role) ? role : null;
}

router.get("/", requireManager, async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`${USER_SELECT} ORDER BY u.isMaster DESC, u.nome COLLATE NOCASE ASC`);
  res.json(rows.map(serializeUser));
});

router.post("/", requireRole("super_admin"), async (req, res) => {
  const nome = trimText(req.body?.nome);
  const email = normalizeEmail(req.body?.email);
  const senha = String(req.body?.senha ?? req.body?.password ?? "");
  const role = normalizeRole(req.body?.role || "user");
  if (!nome || !email || !senha) throw badRequest("Nome, email e senha sao obrigatorios.");
  if (!isValidEmail(email)) throw badRequest("Email invalido.");
  if (!role) throw badRequest("Perfil invalido.");
  const policyError = validatePasswordPolicy(senha);
  if (policyError) throw badRequest(policyError);

  const db = await getDb();
  if (await db.get("SELECT id FROM users WHERE email = ?", email)) throw conflict("Ja existe usuario com este email.");
  const department = await resolveDepartment(db, req.body, req.user.id);
  const { salt, hash } = createPasswordHash(senha);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO users (id, nome, email, passwordHash, passwordSalt, foto, tema, role, active, isMaster, departmentId, createdByUserId, createdAt, updatedAt, passwordChangedAt)
     VALUES (?, ?, ?, ?, ?, '', 'light', ?, ?, 0, ?, ?, ?, ?, ?)`,
    id, nome, email, hash, salt, role, req.body?.active === false ? 0 : 1, department?.id || null, req.user.id, now, now, now
  );
  res.status(201).json({ user: serializeUser(await loadUser(db, id)) });
});

router.patch("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const target = await db.get("SELECT * FROM users WHERE id = ?", req.params.id);
  if (!target) throw notFound("Usuario nao encontrado.");
  const actor = req.user;
  const isSelf = actor.id === target.id;
  const isSuper = actor.role === "super_admin";

  if (!isSuper && (target.role !== "user" || target.isMaster)) throw forbidden("Admin so pode alterar usuarios com perfil Usuario.");
  if (target.isMaster && !isSelf && actor.role === "super_admin" && !actor.isMaster) {
    // Outros super admins nao alteram credenciais do master.
    if (req.body?.email !== undefined || req.body?.novaSenha || req.body?.password) throw forbidden("Somente o proprio usuario master altera o email e a senha dele.");
  }

  const payload = req.body || {};
  const updates = [];
  const values = [];
  let revokeSessions = false;

  if (payload.nome !== undefined) {
    if (!isSuper) throw forbidden("Somente Super Admin altera o nome.");
    const nome = trimText(payload.nome);
    if (!nome) throw badRequest("Nome invalido.");
    updates.push("nome = ?"); values.push(nome);
  }
  if (payload.email !== undefined) {
    const email = normalizeEmail(payload.email);
    if (!isValidEmail(email)) throw badRequest("Email invalido.");
    if (email !== target.email) {
      if (await db.get("SELECT id FROM users WHERE email = ? AND id <> ?", email, target.id)) throw conflict("Ja existe usuario com este email.");
      updates.push("email = ?"); values.push(email);
    }
  }
  const newPassword = String(payload.novaSenha || payload.password || "");
  if (newPassword) {
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) throw badRequest(policyError);
    const { salt, hash } = createPasswordHash(newPassword);
    updates.push("passwordHash = ?", "passwordSalt = ?", "passwordChangedAt = ?");
    values.push(hash, salt, nowIso());
    revokeSessions = !isSelf;
  }
  if (payload.role !== undefined) {
    if (!isSuper) throw forbidden("Somente Super Admin altera perfis.");
    const role = normalizeRole(payload.role);
    if (!role) throw badRequest("Perfil invalido.");
    if (role !== target.role) {
      if (target.isMaster) throw forbidden("O perfil do usuario master nao pode ser alterado.");
      if (isSelf) throw forbidden("Voce nao pode alterar o proprio perfil.");
      updates.push("role = ?"); values.push(role);
    }
  }
  if (payload.departmentId !== undefined || payload.departamento !== undefined || payload.department !== undefined) {
    if (!isSuper) throw forbidden("Somente Super Admin altera departamentos.");
    const department = await resolveDepartment(db, payload, actor.id);
    updates.push("departmentId = ?"); values.push(department?.id || null);
  }
  if (payload.active !== undefined) {
    if (!isSuper) throw forbidden("Somente Super Admin ativa ou desativa usuarios.");
    const active = payload.active ? 1 : 0;
    if (active !== target.active) {
      if (target.isMaster) throw forbidden("O usuario master nao pode ser desativado.");
      if (isSelf) throw forbidden("Voce nao pode desativar a si mesmo.");
      updates.push("active = ?"); values.push(active);
      if (!active) revokeSessions = true;
    }
  }

  if (!updates.length) throw badRequest("Nenhuma alteracao informada.");
  updates.push("updatedAt = ?"); values.push(nowIso(), target.id);
  await db.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, ...values);
  if (revokeSessions) await db.run("DELETE FROM user_sessions WHERE userId = ?", target.id);
  res.json({ user: serializeUser(await loadUser(db, target.id)) });
});

router.delete("/:id", requireRole("super_admin"), async (req, res) => {
  const db = await getDb();
  const target = await db.get("SELECT * FROM users WHERE id = ?", req.params.id);
  if (!target) throw notFound("Usuario nao encontrado.");
  if (target.isMaster) throw forbidden("O usuario master nao pode ser removido.");
  if (target.id === req.user.id) throw forbidden("Voce nao pode remover a si mesmo.");
  const owned = await db.get("SELECT COUNT(*) AS total FROM projects WHERE responsibleUserId = ?", target.id);
  await db.run("DELETE FROM users WHERE id = ?", target.id);
  res.json({ ok: true, orphanedProjects: Number(owned?.total || 0) });
});

// ─── Proprio usuario ──────────────────────────────────────────────────────────
router.put("/me/photo", requireAuth, async (req, res) => {
  const foto = typeof req.body?.foto === "string" ? req.body.foto : "";
  if (foto && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(foto)) throw badRequest("Formato de imagem invalido.");
  if (foto.length > MAX_PHOTO_CHARS) throw badRequest("Imagem muito grande. Use uma imagem menor.");
  const db = await getDb();
  await db.run("UPDATE users SET foto = ?, updatedAt = ? WHERE id = ?", foto, nowIso(), req.user.id);
  res.json({ user: serializeUser(await loadUser(db, req.user.id)) });
});

router.put("/me/password", requireAuth, async (req, res) => {
  const senhaAtual = String(req.body?.senhaAtual || "");
  const novaSenha = String(req.body?.novaSenha || "");
  if (!senhaAtual || !novaSenha) throw badRequest("Senha atual e nova senha sao obrigatorias.");
  if (!verifyPassword(senhaAtual, req.user.passwordSalt, req.user.passwordHash)) throw badRequest("Senha atual incorreta.");
  if (senhaAtual === novaSenha) throw badRequest("A nova senha deve ser diferente da atual.");
  const policyError = validatePasswordPolicy(novaSenha);
  if (policyError) throw badRequest(policyError);
  const db = await getDb();
  const { salt, hash } = createPasswordHash(novaSenha);
  const now = nowIso();
  await db.run("UPDATE users SET passwordHash = ?, passwordSalt = ?, passwordChangedAt = ?, updatedAt = ? WHERE id = ?", hash, salt, now, now, req.user.id);
  // Encerra as demais sessoes e mantem a atual.
  await db.run("DELETE FROM user_sessions WHERE userId = ? AND tokenHash <> ?", req.user.id, req.tokenHash);
  res.status(204).send();
});

export default router;
