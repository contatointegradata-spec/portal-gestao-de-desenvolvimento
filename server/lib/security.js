import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

export function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  return safeEqualHex(hashPassword(password, salt), expectedHash);
}

export function safeEqualHex(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Regra de senha: minimo de 8 caracteres, com letras e numeros. */
export function validatePasswordPolicy(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "A senha deve conter letras e numeros.";
  return "";
}

// ─── Criptografia de segredos (credenciais de API) ────────────────────────────
const SECRET_PREFIX = "enc:v1:";
let cachedKey = null;

function loadSecretKey() {
  if (cachedKey) return cachedKey;
  if (config.secretKey) {
    cachedKey = crypto.createHash("sha256").update(config.secretKey).digest();
    return cachedKey;
  }
  // Sem APP_SECRET_KEY: gera uma chave local persistida ao lado do banco.
  const keyFile = path.join(config.dataDir, ".gestao-secret.key");
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    console.warn(`[security] APP_SECRET_KEY nao definida. Chave gerada em ${keyFile} — faca backup junto com o banco.`);
  }
  cachedKey = crypto.createHash("sha256").update(fs.readFileSync(keyFile, "utf8").trim()).digest();
  return cachedKey;
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(value) {
  const text = String(value ?? "");
  if (!text || isEncrypted(text)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadSecretKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(value) {
  if (!isEncrypted(value)) return String(value ?? "");
  try {
    const [ivB64, tagB64, dataB64] = value.slice(SECRET_PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", loadSecretKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    console.error("[security] Falha ao descriptografar segredo (chave alterada?).");
    return "";
  }
}

// ─── Rate limit em memoria ────────────────────────────────────────────────────
const buckets = new Map();

/**
 * Registra uma tentativa e informa se o limite foi excedido.
 * Retorna { limited, retryAfterSeconds }.
 */
export function hitRateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { limited: true, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

export function isRateLimited(key, max) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= Date.now()) return { limited: false, retryAfterSeconds: 0 };
  return bucket.count >= max
    ? { limited: true, retryAfterSeconds: Math.ceil((bucket.resetAt - Date.now()) / 1000) }
    : { limited: false, retryAfterSeconds: 0 };
}

export function clearRateLimit(key) {
  buckets.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();
