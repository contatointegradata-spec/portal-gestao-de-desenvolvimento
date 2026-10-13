import { SECRET_MASK } from "../../stores/apiWorkspace.js";

const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const secret = (value, placeholder) => (value === SECRET_MASK ? placeholder : value);

/** Gera um comando cURL equivalente ao rascunho (variaveis {{...}} sao mantidas). */
export function toCurl(draft, inherited) {
  const parts = ["curl"];
  if (draft.method !== "GET") parts.push(`-X ${draft.method}`);
  let url = draft.url || "";
  const params = (draft.queryParams || []).filter((item) => item.enabled !== false && item.key);
  if (params.length) url += `${url.includes("?") ? "&" : "?"}${params.map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`).join("&")}`;

  const auth = draft.authType === "inherit" ? inherited : { type: draft.authType, config: draft.authConfig || {} };
  const config = auth?.config || {};
  if (auth?.type === "api_key" && config.in === "query" && config.key) {
    url += `${url.includes("?") ? "&" : "?"}${encodeURIComponent(config.key)}=${encodeURIComponent(secret(config.value, "<API_KEY>"))}`;
  }
  parts.push(quote(url));

  for (const header of (draft.headers || []).filter((item) => item.enabled !== false && item.key)) parts.push(`-H ${quote(`${header.key}: ${header.value}`)}`);
  if (auth?.type === "bearer") parts.push(`-H ${quote(`Authorization: ${config.prefix || "Bearer"} ${secret(config.token, "<TOKEN>")}`)}`);
  if (auth?.type === "basic") parts.push(`-u ${quote(`${config.username || ""}:${secret(config.password, "<SENHA>")}`)}`);
  if (auth?.type === "api_key" && config.in !== "query" && config.key) parts.push(`-H ${quote(`${config.key}: ${secret(config.value, "<API_KEY>")}`)}`);
  if (auth?.type === "oauth2") parts.push(`-H ${quote("Authorization: Bearer <TOKEN_OAUTH2>")}`);

  if (["json", "text", "xml"].includes(draft.bodyType) && draft.bodyContent) {
    const contentType = { json: "application/json", text: "text/plain", xml: "application/xml" }[draft.bodyType];
    if (!(draft.headers || []).some((item) => item.enabled !== false && item.key.toLowerCase() === "content-type")) parts.push(`-H ${quote(`Content-Type: ${contentType}`)}`);
    parts.push(`--data-raw ${quote(draft.bodyContent)}`);
  } else if (draft.bodyType === "form_urlencoded") {
    for (const field of (draft.formFields || []).filter((item) => item.enabled !== false && item.key)) parts.push(`--data-urlencode ${quote(`${field.key}=${field.value}`)}`);
  } else if (draft.bodyType === "multipart") {
    for (const field of (draft.formFields || []).filter((item) => item.enabled !== false && item.key)) parts.push(`-F ${quote(`${field.key}=${field.value}`)}`);
  }
  if (draft.settings?.insecureTls) parts.push("-k");
  if (draft.settings?.followRedirects !== false) parts.push("-L");
  return parts.join(" \\\n  ");
}

/** Lista variaveis {{nome}} usadas no rascunho. */
export function collectVariables(draft) {
  const sources = [
    draft.url,
    ...(draft.queryParams || []).filter((item) => item.enabled !== false).flatMap((item) => [item.key, item.value]),
    ...(draft.headers || []).filter((item) => item.enabled !== false).flatMap((item) => [item.key, item.value]),
    ...(["json", "text", "xml"].includes(draft.bodyType) ? [draft.bodyContent] : []),
    ...(["form_urlencoded", "multipart"].includes(draft.bodyType) ? (draft.formFields || []).flatMap((item) => [item.key, item.value]) : []),
    ...Object.values(draft.authConfig || {})
  ];
  const names = new Set();
  for (const source of sources) {
    for (const match of String(source || "").matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) names.add(match[1]);
  }
  return [...names];
}
