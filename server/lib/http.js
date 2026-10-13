import express from "express";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new HttpError(400, message, extra);
export const forbidden = (message = "Sem permissao para esta acao.") => new HttpError(403, message);
export const notFound = (message = "Registro nao encontrado.") => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);

/** Router do Express que encaminha erros de handlers async para o middleware de erro. */
export function asyncRouter() {
  const router = express.Router();
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const original = router[method].bind(router);
    router[method] = (routePath, ...handlers) => original(routePath, ...handlers.map(wrapAsync));
  }
  return router;
}

export function wrapAsync(handler) {
  if (typeof handler !== "function" || handler.length > 3) return handler;
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function trimText(value) {
  return String(value ?? "").trim();
}

export function normalizeEmail(value) {
  return trimText(value).toLowerCase();
}

export function boolToInt(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}\n...[conteudo truncado]` : text;
}

export function nowIso() {
  return new Date().toISOString();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}
