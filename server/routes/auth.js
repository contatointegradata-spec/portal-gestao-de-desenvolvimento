import crypto from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { asyncRouter, badRequest, clientIp, HttpError, normalizeEmail, nowIso, trimText } from "../lib/http.js";
import { isMailConfigured, sendResetCodeEmail } from "../lib/mailer.js";
import {
  clearRateLimit, createPasswordHash, hashToken, hitRateLimit, isRateLimited, randomToken,
  validatePasswordPolicy, verifyPassword
} from "../lib/security.js";
import { loadUser, serializeUser } from "../lib/users.js";

const router = asyncRouter();
const LOGIN_MAX_FAILURES = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;
const GENERIC_CODE_ERROR = "Codigo invalido ou expirado.";

function tooManyRequests(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new HttpError(429, `Muitas tentativas. Tente novamente em ${minutes} minuto(s).`);
}

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email || !password) throw badRequest("Email e senha sao obrigatorios.");

  const limitKey = `login:${clientIp(req)}:${email}`;
  const status = isRateLimited(limitKey, LOGIN_MAX_FAILURES);
  if (status.limited) throw tooManyRequests(status.retryAfterSeconds);

  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  const valid = user && user.active && verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!valid) {
    hitRateLimit(limitKey, { max: LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS });
    if (user && !user.active && verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      throw new HttpError(403, "Usuario inativo. Procure um administrador.");
    }
    throw new HttpError(401, "Email ou senha invalidos.");
  }
  clearRateLimit(limitKey);

  const now = new Date();
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + config.sessionDurationDays * 86400000).toISOString();
  await db.run("DELETE FROM user_sessions WHERE expiresAt <= ?", now.toISOString());
  await db.run(
    "INSERT INTO user_sessions (tokenHash, userId, createdAt, expiresAt, lastSeenAt, userAgent) VALUES (?, ?, ?, ?, ?, ?)",
    hashToken(token), user.id, now.toISOString(), expiresAt, now.toISOString(), trimText(req.headers["user-agent"]).slice(0, 300)
  );
  await db.run("UPDATE users SET lastLoginAt = ? WHERE id = ?", now.toISOString(), user.id);
  res.json({ token, expiresAt, user: serializeUser(await loadUser(db, user.id)) });
});

router.post("/register", (_req, _res) => {
  throw new HttpError(403, "Criacao publica de usuarios esta desativada. Solicite a um Super Admin.");
});

router.post("/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) throw badRequest("Email e obrigatorio.");

  const ipLimit = hitRateLimit(`forgot-ip:${clientIp(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
  const emailLimit = hitRateLimit(`forgot:${email}`, { max: 3, windowMs: 15 * 60 * 1000 });
  if (ipLimit.limited || emailLimit.limited) throw tooManyRequests(Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds));

  const genericMessage = "Se o email estiver cadastrado, enviaremos um codigo de recuperacao.";
  const db = await getDb();
  const user = await db.get("SELECT * FROM users WHERE email = ? AND active = 1", email);
  if (!user) return res.json({ message: genericMessage });
  if (!isMailConfigured()) throw new HttpError(503, "O envio de email nao esta configurado no servidor. Procure um administrador.");

  const code = String(crypto.randomInt(100000, 1000000));
  const now = new Date();
  await db.run("DELETE FROM password_reset_tokens WHERE userId = ?", user.id);
  await db.run(
    "INSERT INTO password_reset_tokens (tokenHash, userId, createdAt, expiresAt, usedAt, attempts) VALUES (?, ?, ?, ?, NULL, 0)",
    hashToken(`${user.id}:${code}`), user.id, now.toISOString(), new Date(now.getTime() + RESET_CODE_TTL_MS).toISOString()
  );

  try {
    await sendResetCodeEmail({ to: user.email, name: user.nome, code });
  } catch (error) {
    console.error("[auth] Falha ao enviar email de recuperacao:", error.message);
    await db.run("DELETE FROM password_reset_tokens WHERE userId = ?", user.id);
    throw new HttpError(502, "Nao foi possivel enviar o email de recuperacao. Tente novamente mais tarde.");
  }
  res.json({ message: genericMessage });
});

/** Valida o codigo contando tentativas; apos o limite o codigo e invalidado. */
async function consumeResetAttempt(db, email, code) {
  const user = await db.get("SELECT * FROM users WHERE email = ? AND active = 1", email);
  if (!user) throw badRequest(GENERIC_CODE_ERROR);
  const token = await db.get(
    "SELECT * FROM password_reset_tokens WHERE userId = ? AND usedAt IS NULL AND expiresAt > ?",
    user.id, nowIso()
  );
  if (!token) throw badRequest(GENERIC_CODE_ERROR);
  if (token.tokenHash !== hashToken(`${user.id}:${code}`)) {
    const attempts = (token.attempts || 0) + 1;
    if (attempts >= RESET_CODE_MAX_ATTEMPTS) {
      await db.run("DELETE FROM password_reset_tokens WHERE tokenHash = ?", token.tokenHash);
      throw badRequest("Codigo invalidado apos muitas tentativas. Solicite um novo codigo.");
    }
    await db.run("UPDATE password_reset_tokens SET attempts = ? WHERE tokenHash = ?", attempts, token.tokenHash);
    throw badRequest(GENERIC_CODE_ERROR);
  }
  return { user, token };
}

router.post("/verify-reset-code", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = trimText(req.body?.code);
  if (!email || !code) throw badRequest("Email e codigo sao obrigatorios.");
  const db = await getDb();
  await consumeResetAttempt(db, email, code);
  res.json({ ok: true, message: "Codigo validado. Defina sua nova senha." });
});

router.post("/reset-password", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = trimText(req.body?.code);
  const novaSenha = String(req.body?.novaSenha || "");
  if (!email || !code || !novaSenha) throw badRequest("Email, codigo e nova senha sao obrigatorios.");
  const policyError = validatePasswordPolicy(novaSenha);
  if (policyError) throw badRequest(policyError);

  const db = await getDb();
  const { user, token } = await consumeResetAttempt(db, email, code);
  const { salt, hash } = createPasswordHash(novaSenha);
  const now = nowIso();
  await db.run("UPDATE users SET passwordHash = ?, passwordSalt = ?, passwordChangedAt = ?, updatedAt = ? WHERE id = ?", hash, salt, now, now, user.id);
  await db.run("UPDATE password_reset_tokens SET usedAt = ? WHERE tokenHash = ?", now, token.tokenHash);
  await db.run("DELETE FROM user_sessions WHERE userId = ?", user.id);
  res.status(204).send();
});

router.get("/me", requireAuth, async (req, res) => {
  const db = await getDb();
  res.json({ user: serializeUser(await loadUser(db, req.user.id)) });
});

router.post("/logout", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM user_sessions WHERE tokenHash = ?", req.tokenHash);
  res.status(204).send();
});

export default router;
