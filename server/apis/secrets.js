import { decryptSecret, encryptSecret, isEncrypted } from "../lib/security.js";

/** Valor enviado ao cliente no lugar de um segredo salvo. Se voltar igual, o segredo e mantido. */
export const SECRET_MASK = "__SECRET_UNCHANGED__";

export const AUTH_TYPES = ["inherit", "none", "bearer", "basic", "api_key", "oauth2"];

const SECRET_FIELDS = {
  bearer: ["token"],
  basic: ["password"],
  api_key: ["value"],
  oauth2: ["clientSecret", "password"]
};

const ALLOWED_FIELDS = {
  inherit: [],
  none: [],
  bearer: ["token", "prefix"],
  basic: ["username", "password"],
  api_key: ["key", "value", "in"],
  oauth2: ["grantType", "tokenUrl", "clientId", "clientSecret", "scope", "audience", "username", "password", "credentialsLocation", "headerPrefix"]
};

export function normalizeAuthType(value, { allowInherit = true } = {}) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "oauth2_client_credentials") return "oauth2";
  if (!AUTH_TYPES.includes(type)) return allowInherit ? "inherit" : "none";
  if (type === "inherit" && !allowInherit) return "none";
  return type;
}

function withDefaults(type, config) {
  if (type === "api_key") return { ...config, in: config.in === "query" ? "query" : "header" };
  if (type === "oauth2") {
    return {
      ...config,
      grantType: config.grantType === "password" ? "password" : "client_credentials",
      credentialsLocation: config.credentialsLocation === "basic_auth_header" ? "basic_auth_header" : "body",
      headerPrefix: config.headerPrefix || "Bearer"
    };
  }
  if (type === "bearer") return { ...config, prefix: config.prefix || "Bearer" };
  return config;
}

/**
 * Prepara o authConfig para gravacao: filtra campos, criptografa segredos e
 * preserva segredos existentes quando o cliente devolve a mascara.
 */
export function prepareAuthConfigForStorage(type, incoming, existingStored = {}) {
  const allowed = ALLOWED_FIELDS[type] || [];
  const secrets = SECRET_FIELDS[type] || [];
  const source = incoming && typeof incoming === "object" ? incoming : {};
  const result = {};
  for (const field of allowed) {
    let value = source[field];
    if (value === undefined || value === null) value = "";
    value = String(value);
    if (secrets.includes(field)) {
      if (value === SECRET_MASK) {
        result[field] = existingStored?.[field] || "";
      } else {
        result[field] = value ? encryptSecret(value) : "";
      }
    } else {
      result[field] = value;
    }
  }
  return withDefaults(type, result);
}

/** Versao para o cliente: segredos viram mascara + flag de preenchimento. */
export function maskAuthConfig(type, stored) {
  const secrets = SECRET_FIELDS[type] || [];
  const result = { ...(stored || {}) };
  const filled = {};
  for (const field of secrets) {
    filled[field] = Boolean(result[field]);
    result[field] = result[field] ? SECRET_MASK : "";
  }
  return { config: withDefaults(type, result), secretsFilled: filled };
}

/** Versao em texto puro, usada apenas no servidor para executar a requisicao. */
export function revealAuthConfig(type, stored) {
  const secrets = SECRET_FIELDS[type] || [];
  const result = { ...(stored || {}) };
  for (const field of secrets) {
    if (result[field]) result[field] = decryptSecret(result[field]);
  }
  return withDefaults(type, result);
}

/** Mescla um authConfig enviado pelo cliente (rascunho) com os segredos salvos. */
export function resolveDraftAuthConfig(type, draft, stored) {
  const secrets = SECRET_FIELDS[type] || [];
  const revealed = revealAuthConfig(type, stored || {});
  const result = { ...(draft || {}) };
  for (const field of secrets) {
    if (result[field] === SECRET_MASK) result[field] = revealed[field] || "";
  }
  return withDefaults(type, result);
}

// ─── Variaveis de ambiente ────────────────────────────────────────────────────
export function normalizeVariables(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const key = String(item?.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      value: String(item?.value ?? ""),
      secret: Boolean(item?.secret),
      enabled: item?.enabled !== false
    });
  }
  return result;
}

export function prepareVariablesForStorage(incoming, existingStored = []) {
  const existingByKey = new Map((existingStored || []).map((item) => [item.key, item]));
  return normalizeVariables(incoming).map((item) => {
    if (!item.secret) return { ...item, value: isEncrypted(item.value) ? decryptSecret(item.value) : item.value };
    if (item.value === SECRET_MASK) {
      const previous = existingByKey.get(item.key);
      const previousValue = previous?.value || "";
      return { ...item, value: previous?.secret ? previousValue : encryptSecret(previousValue) };
    }
    return { ...item, value: item.value ? encryptSecret(item.value) : "" };
  });
}

export function maskVariables(stored) {
  return (stored || []).map((item) => (item.secret
    ? { ...item, value: item.value ? SECRET_MASK : "", hasValue: Boolean(item.value) }
    : { ...item }));
}

export function revealVariables(stored) {
  return (stored || []).map((item) => (item.secret ? { ...item, value: decryptSecret(item.value) } : { ...item }));
}

export function encryptLegacyAuthConfig(type, plainConfig) {
  const result = { ...(plainConfig || {}) };
  for (const field of SECRET_FIELDS[type] || []) {
    if (result[field] && !isEncrypted(result[field])) result[field] = encryptSecret(result[field]);
  }
  return withDefaults(type, result);
}
