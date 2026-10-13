import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { localParts } from "../rpa/schedule.js";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const BODY_TYPES = ["none", "json", "text", "xml", "form_urlencoded", "multipart"];
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 300000;
const MASK = "••••••";
const SENSITIVE_HEADERS = ["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "x-auth-token"];
const VAR_RE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

// ─── Variaveis ────────────────────────────────────────────────────────────────
function dynamicVariable(key) {
  switch (key) {
    case "$timestamp": return String(Math.floor(Date.now() / 1000));
    case "$timestampMs": return String(Date.now());
    case "$isoTimestamp": return new Date().toISOString();
    case "$randomUUID":
    case "$guid": return crypto.randomUUID();
    case "$randomInt": return String(Math.floor(Math.random() * 1000));
    case "$date": return localParts().date;
    default: return undefined;
  }
}

export function createResolver(variables = []) {
  const values = new Map();
  for (const item of variables) {
    if (item && item.enabled !== false && item.key) values.set(item.key, String(item.value ?? ""));
  }
  const unresolved = new Set();
  const resolve = (input, depth = 0) => String(input ?? "").replace(VAR_RE, (match, key) => {
    const dynamic = key.startsWith("$") ? dynamicVariable(key) : undefined;
    if (dynamic !== undefined) return dynamic;
    if (values.has(key)) return depth < 5 ? resolve(values.get(key), depth + 1) : values.get(key);
    unresolved.add(key);
    return match;
  });
  return { resolve, unresolved };
}

// ─── Transporte HTTP ──────────────────────────────────────────────────────────
function friendlyNetworkError(error, insecureTls) {
  const code = error?.code || "";
  const messages = {
    ENOTFOUND: "Host nao encontrado (falha de DNS). Verifique a URL.",
    EAI_AGAIN: "Falha temporaria de DNS. Tente novamente.",
    ECONNREFUSED: "Conexao recusada pelo servidor de destino.",
    ECONNRESET: "A conexao foi encerrada pelo servidor de destino.",
    ETIMEDOUT: "Tempo de conexao esgotado.",
    EHOSTUNREACH: "Host inacessivel a partir do servidor da plataforma.",
    CERT_HAS_EXPIRED: "Certificado SSL do destino expirado.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "Certificado SSL autoassinado.",
    SELF_SIGNED_CERT_IN_CHAIN: "Certificado SSL autoassinado na cadeia.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "Nao foi possivel validar o certificado SSL.",
    ERR_TLS_CERT_ALTNAME_INVALID: "O certificado SSL nao corresponde ao host."
  };
  let message = messages[code] || error?.message || "Falha na requisicao.";
  if (!insecureTls && /CERT|SELF_SIGNED|LEAF_SIGNATURE|ALTNAME/.test(code)) {
    message += " Para ambientes de teste, ative \"Ignorar verificacao SSL\" nas configuracoes da requisicao.";
  }
  return code ? `${message} (${code})` : message;
}

function decompress(buffer, encoding) {
  try {
    const value = String(encoding || "").toLowerCase();
    if (value.includes("gzip")) return zlib.gunzipSync(buffer);
    if (value.includes("br")) return zlib.brotliDecompressSync(buffer);
    if (value.includes("deflate")) {
      try { return zlib.inflateSync(buffer); } catch { return zlib.inflateRawSync(buffer); }
    }
  } catch {
    return buffer;
  }
  return buffer;
}

function sendOnce({ method, url, headers, body, timeoutMs, insecureTls }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const started = process.hrtime.bigint();
    const req = transport.request(target, {
      method,
      headers,
      rejectUnauthorized: !insecureTls,
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      let received = 0;
      let truncated = false;
      res.on("data", (chunk) => {
        if (received >= MAX_RESPONSE_BYTES) {
          truncated = true;
          return;
        }
        received += chunk.length;
        chunks.push(chunk);
      });
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          statusText: res.statusMessage || http.STATUS_CODES[res.statusCode] || "",
          headers: res.headers,
          body: decompress(raw, res.headers["content-encoding"]),
          truncated,
          durationMs: Number(process.hrtime.bigint() - started) / 1e6
        });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error(`Tempo limite de ${timeoutMs} ms excedido.`), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

export async function sendHttp({ method, url, headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, insecureTls = false, followRedirects = true }) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  const currentHeaders = { ...headers };
  const redirects = [];
  let totalMs = 0;

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    let response;
    try {
      response = await sendOnce({ method: currentMethod, url: currentUrl, headers: currentHeaders, body: currentBody, timeoutMs, insecureTls });
    } catch (error) {
      const wrapped = new Error(friendlyNetworkError(error, insecureTls));
      wrapped.code = error.code;
      throw wrapped;
    }
    totalMs += response.durationMs;
    const location = response.headers.location;
    if (followRedirects && location && [301, 302, 303, 307, 308].includes(response.statusCode) && attempt < MAX_REDIRECTS) {
      const nextUrl = new URL(location, currentUrl).toString();
      redirects.push({ statusCode: response.statusCode, from: currentUrl, to: nextUrl });
      if (response.statusCode === 303 || ([301, 302].includes(response.statusCode) && currentMethod !== "GET" && currentMethod !== "HEAD")) {
        currentMethod = "GET";
        currentBody = null;
        delete currentHeaders["content-length"];
        delete currentHeaders["content-type"];
      }
      if (new URL(nextUrl).host !== new URL(currentUrl).host) delete currentHeaders.authorization;
      currentUrl = nextUrl;
      continue;
    }
    return { ...response, durationMs: Math.round(totalMs), finalUrl: currentUrl, redirects };
  }
  throw new Error("Numero maximo de redirecionamentos excedido.");
}

// ─── OAuth 2.0 ────────────────────────────────────────────────────────────────
const tokenCache = new Map();

function oauthCacheKey(config) {
  return crypto.createHash("sha256").update(JSON.stringify([
    config.grantType, config.tokenUrl, config.clientId, config.clientSecret, config.scope, config.audience, config.username, config.password, config.credentialsLocation
  ])).digest("hex");
}

export function clearOAuthCache() {
  tokenCache.clear();
}

async function fetchOAuthToken(config, { insecureTls, timeoutMs, forceRefresh }) {
  if (!config.tokenUrl) throw new Error("OAuth 2.0: informe a URL do token.");
  if (!config.clientId) throw new Error("OAuth 2.0: informe o Client ID.");
  const key = oauthCacheKey(config);
  const cached = tokenCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 30000) return { ...cached, fromCache: true };

  const form = new URLSearchParams();
  form.set("grant_type", config.grantType === "password" ? "password" : "client_credentials");
  if (config.grantType === "password") {
    form.set("username", config.username || "");
    form.set("password", config.password || "");
  }
  if (config.scope) form.set("scope", config.scope);
  if (config.audience) form.set("audience", config.audience);
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (config.credentialsLocation === "basic_auth_header") {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret || ""}`).toString("base64")}`;
  } else {
    form.set("client_id", config.clientId);
    if (config.clientSecret) form.set("client_secret", config.clientSecret);
  }
  const body = Buffer.from(form.toString());
  headers["content-length"] = String(body.length);

  const response = await sendHttp({ method: "POST", url: config.tokenUrl, headers, body, insecureTls, timeoutMs, followRedirects: true });
  const text = response.body.toString("utf8");
  if (response.statusCode >= 400) throw new Error(`OAuth 2.0: falha ao obter token (HTTP ${response.statusCode}): ${text.slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OAuth 2.0: resposta do servidor de token nao e JSON.");
  }
  if (!parsed.access_token) throw new Error("OAuth 2.0: a resposta nao contem access_token.");
  const entry = {
    accessToken: parsed.access_token,
    tokenType: parsed.token_type || "Bearer",
    expiresAt: Date.now() + (Number(parsed.expires_in) || 300) * 1000
  };
  tokenCache.set(key, entry);
  return { ...entry, fromCache: false };
}

// ─── Montagem da requisicao ───────────────────────────────────────────────────
function setHeader(headers, name, value) {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing) delete headers[existing];
  headers[name.toLowerCase()] = value;
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function resolveList(list, resolve) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.enabled !== false && String(item.key ?? "").trim())
    .map((item) => ({ key: resolve(String(item.key).trim()), value: resolve(item.value ?? "") }));
}

function buildMultipart(fields) {
  const boundary = `----GestaoIntegradata${crypto.randomBytes(12).toString("hex")}`;
  const parts = fields.map((field) => Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field.key.replace(/"/g, "%22")}"\r\n\r\n${field.value}\r\n`
  ));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function isTextContent(contentType, buffer) {
  if (/json|text|xml|html|javascript|x-www-form-urlencoded|csv|yaml|graphql/i.test(contentType || "")) return true;
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, 2048);
  if (sample.includes(0)) return false;
  return !sample.toString("utf8").includes("�");
}

function maskHeaders(headers, extraSensitive = []) {
  const sensitive = new Set([...SENSITIVE_HEADERS, ...extraSensitive.map((item) => item.toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, sensitive.has(key.toLowerCase()) ? MASK : value]));
}

function readPath(source, rawPath) {
  const pathText = String(rawPath || "").trim().replace(/^\$\.?/, "");
  if (!pathText) return source;
  const tokens = pathText.match(/[^.[\]]+|\[(\d+)\]/g) || [];
  let current = source;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    const indexMatch = token.match(/^\[(\d+)\]$/);
    current = indexMatch ? current[Number(indexMatch[1])] : current[token];
  }
  return current;
}

/** Aplica as regras "apos a resposta" e devolve os valores extraidos. */
export function extractValues(rules, response) {
  const results = [];
  let parsedBody;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || rule.enabled === false || !rule.variable) continue;
    try {
      let value;
      if (rule.source === "header") {
        value = response.headers[String(rule.path || "").toLowerCase()];
      } else if (rule.source === "status") {
        value = response.statusCode;
      } else {
        if (parsedBody === undefined) parsedBody = JSON.parse(response.bodyText);
        value = readPath(parsedBody, rule.path);
      }
      if (value === undefined || value === null) {
        results.push({ variable: rule.variable, ok: false, error: `Caminho "${rule.path}" nao encontrado na resposta.` });
        continue;
      }
      results.push({ variable: rule.variable, ok: true, value: typeof value === "object" ? JSON.stringify(value) : String(value), secret: Boolean(rule.secret) });
    } catch {
      results.push({ variable: rule.variable, ok: false, error: "A resposta nao e um JSON valido." });
    }
  }
  return results;
}

/**
 * Executa uma requisicao ja com autenticacao efetiva e variaveis resolvidas.
 * request: { method, url, queryParams, headers, bodyType, bodyContent, formFields, settings }
 * auth: { type, config (texto puro), source }
 */
export async function executeRequest({ request, auth, variables }) {
  const { resolve, unresolved } = createResolver(variables);
  const settings = request.settings || {};
  const timeoutMs = Math.min(Math.max(Number(settings.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
  const insecureTls = Boolean(settings.insecureTls);
  const method = HTTP_METHODS.includes(String(request.method).toUpperCase()) ? String(request.method).toUpperCase() : "GET";

  let urlText = resolve(request.url).trim();
  if (!urlText) throw Object.assign(new Error("Informe a URL da requisicao."), { status: 400 });
  if (!/^https?:\/\//i.test(urlText)) urlText = `http://${urlText}`;
  let url;
  try {
    url = new URL(urlText);
  } catch {
    throw Object.assign(new Error(`URL invalida: ${urlText}`), { status: 400 });
  }
  for (const param of resolveList(request.queryParams, resolve)) url.searchParams.append(param.key, param.value);

  const headers = {};
  for (const header of resolveList(request.headers, resolve)) setHeader(headers, header.key, header.value);

  // Autenticacao
  const extraSensitiveHeaders = [];
  const sensitiveQuery = [];
  const authInfo = { type: auth?.type || "none", source: auth?.source || "request" };
  const authConfig = Object.fromEntries(Object.entries(auth?.config || {}).map(([key, value]) => [key, resolve(value)]));
  if (auth?.type === "bearer" && authConfig.token && !hasHeader(headers, "authorization")) {
    setHeader(headers, "authorization", `${authConfig.prefix || "Bearer"} ${authConfig.token}`.trim());
  } else if (auth?.type === "basic" && !hasHeader(headers, "authorization")) {
    setHeader(headers, "authorization", `Basic ${Buffer.from(`${authConfig.username || ""}:${authConfig.password || ""}`).toString("base64")}`);
  } else if (auth?.type === "api_key" && authConfig.key) {
    if (authConfig.in === "query") {
      url.searchParams.set(authConfig.key, authConfig.value || "");
      sensitiveQuery.push(authConfig.key);
    } else {
      setHeader(headers, authConfig.key, authConfig.value || "");
      extraSensitiveHeaders.push(authConfig.key);
    }
  } else if (auth?.type === "oauth2" && !hasHeader(headers, "authorization")) {
    const token = await fetchOAuthToken(authConfig, { insecureTls, timeoutMs, forceRefresh: Boolean(request.forceTokenRefresh) });
    setHeader(headers, "authorization", `${authConfig.headerPrefix || "Bearer"} ${token.accessToken}`.trim());
    authInfo.tokenFromCache = token.fromCache;
    authInfo.tokenExpiresAt = new Date(token.expiresAt).toISOString();
  }

  // Corpo
  let body = null;
  const bodyType = BODY_TYPES.includes(request.bodyType) ? request.bodyType : "none";
  if (!["GET", "HEAD"].includes(method) || bodyType !== "none") {
    if (bodyType === "json" || bodyType === "text" || bodyType === "xml") {
      body = Buffer.from(resolve(request.bodyContent || ""), "utf8");
      const defaultType = { json: "application/json", text: "text/plain; charset=utf-8", xml: "application/xml" }[bodyType];
      if (!hasHeader(headers, "content-type")) setHeader(headers, "content-type", defaultType);
    } else if (bodyType === "form_urlencoded") {
      const form = new URLSearchParams();
      for (const field of resolveList(request.formFields, resolve)) form.append(field.key, field.value);
      body = Buffer.from(form.toString(), "utf8");
      if (!hasHeader(headers, "content-type")) setHeader(headers, "content-type", "application/x-www-form-urlencoded");
    } else if (bodyType === "multipart") {
      const multipart = buildMultipart(resolveList(request.formFields, resolve));
      body = multipart.body;
      setHeader(headers, "content-type", multipart.contentType);
    }
  }
  if (body) setHeader(headers, "content-length", String(body.length));
  if (!hasHeader(headers, "user-agent")) setHeader(headers, "user-agent", "GestaoIntegradata-APIClient/2.0");
  if (!hasHeader(headers, "accept")) setHeader(headers, "accept", "*/*");
  if (!hasHeader(headers, "accept-encoding")) setHeader(headers, "accept-encoding", "gzip, deflate, br");

  const maskedUrl = new URL(url.toString());
  for (const key of sensitiveQuery) maskedUrl.searchParams.set(key, MASK);
  const requestSummary = {
    method,
    url: maskedUrl.toString(),
    headers: maskHeaders(headers, extraSensitiveHeaders),
    body: body ? body.subarray(0, 20000).toString("utf8") : ""
  };

  const response = await sendHttp({ method, url: url.toString(), headers, body, timeoutMs, insecureTls, followRedirects: settings.followRedirects !== false });
  const contentType = String(response.headers["content-type"] || "");
  const text = isTextContent(contentType, response.body);
  return {
    statusCode: response.statusCode,
    statusText: response.statusText,
    durationMs: response.durationMs,
    size: response.body.length,
    truncated: response.truncated,
    headers: response.headers,
    contentType,
    bodyEncoding: text ? "utf8" : "base64",
    body: text ? response.body.toString("utf8") : response.body.toString("base64"),
    bodyText: text ? response.body.toString("utf8") : "",
    finalUrl: response.finalUrl,
    redirects: response.redirects,
    request: requestSummary,
    auth: authInfo,
    unresolvedVariables: [...unresolved]
  };
}
