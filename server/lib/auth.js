import { getDb } from "../db.js";
import { hashToken } from "./security.js";
import { HttpError, wrapAsync } from "./http.js";

export const ROLES = ["super_admin", "admin", "user"];
export const MANAGER_ROLES = ["super_admin", "admin"];

export function isManager(user) {
  return MANAGER_ROLES.includes(user?.role);
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function authenticate(req) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Nao autenticado.");
  const db = await getDb();
  const tokenHash = hashToken(token);
  const now = new Date();
  const session = await db.get("SELECT * FROM user_sessions WHERE tokenHash = ? AND expiresAt > ?", tokenHash, now.toISOString());
  if (!session) throw new HttpError(401, "Sessao expirada. Entre novamente.");
  const user = await db.get("SELECT * FROM users WHERE id = ?", session.userId);
  if (!user || !user.active) {
    await db.run("DELETE FROM user_sessions WHERE tokenHash = ?", tokenHash);
    throw new HttpError(401, "Usuario inativo ou removido.");
  }
  // Atualiza "visto por ultimo" no maximo a cada 5 minutos.
  if (!session.lastSeenAt || now - new Date(session.lastSeenAt) > 5 * 60 * 1000) {
    await db.run("UPDATE user_sessions SET lastSeenAt = ? WHERE tokenHash = ?", now.toISOString(), tokenHash);
  }
  req.user = user;
  req.tokenHash = tokenHash;
}

export const requireAuth = wrapAsync(async (req, _res, next) => {
  await authenticate(req);
  next();
});

export function requireRole(...roles) {
  return wrapAsync(async (req, _res, next) => {
    await authenticate(req);
    if (!roles.includes(req.user.role)) throw new HttpError(403, "Sem permissao para esta acao.");
    next();
  });
}

export const requireManager = requireRole(...MANAGER_ROLES);
