import { reactive } from "vue";

const TOKEN_KEY = "gestao_auth_token";

export const authState = reactive({ token: safeStorageGet(TOKEN_KEY) });

let unauthorizedHandler = null;

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  authState.token = token || "";
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // armazenamento indisponivel
  }
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function authHeaders() {
  return authState.token ? { Authorization: `Bearer ${authState.token}` } : {};
}

async function handleResponse(response) {
  if (response.status === 401 && authState.token) {
    unauthorizedHandler?.();
  }
  const contentType = response.headers.get("content-type") || "";
  const data = response.status === 204 ? null : contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const message = (data && typeof data === "object" && (data.error || data.errors?.[0])) || (response.status === 413 ? "Conteudo muito grande." : `Erro ${response.status} na requisicao.`);
    throw new ApiError(message, response.status, data);
  }
  return data;
}

export async function api(path, { method = "GET", body, headers = {}, signal } = {}) {
  const isJson = body !== undefined && !(body instanceof Blob) && !(body instanceof FormData) && !(body instanceof ArrayBuffer);
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: { ...authHeaders(), ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : isJson ? JSON.stringify(body) : body
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError("Nao foi possivel conectar ao servidor. Verifique sua conexao.", 0, null);
  }
  return handleResponse(response);
}

export const http = {
  get: (path, options) => api(path, { ...options, method: "GET" }),
  post: (path, body, options) => api(path, { ...options, method: "POST", body }),
  put: (path, body, options) => api(path, { ...options, method: "PUT", body }),
  patch: (path, body, options) => api(path, { ...options, method: "PATCH", body }),
  del: (path, options) => api(path, { ...options, method: "DELETE" })
};

/** Envia um arquivo binario com progresso (XMLHttpRequest). */
export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    if (authState.token) xhr.setRequestHeader("Authorization", `Bearer ${authState.token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status === 401) unauthorizedHandler?.();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error || (xhr.status === 413 ? "Arquivo excede o tamanho maximo permitido." : "Falha no envio do arquivo."), xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError("Falha de conexao durante o envio.", 0, null));
    xhr.send(file);
  });
}

/** Baixa um arquivo autenticado e dispara o download no navegador. */
export async function downloadFile(path, fallbackName = "arquivo") {
  const response = await fetch(path, { headers: authHeaders() });
  if (!response.ok) {
    await handleResponse(response);
    return;
  }
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match ? decodeURIComponent(match[1]) : fallbackName;
  saveBlob(await response.blob(), fileName);
}

export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Le um endpoint SSE autenticado (fetch + ReadableStream, pois EventSource
 * nao envia o header Authorization). handlers: { [evento]: (data) => void }
 */
export async function streamEvents(path, handlers, signal) {
  const response = await fetch(path, { headers: { ...authHeaders(), Accept: "text/event-stream" }, signal });
  if (!response.ok) {
    await handleResponse(response);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop();
    for (const block of blocks) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      try {
        handlers[event]?.(JSON.parse(data));
      } catch (error) {
        console.error("Evento SSE invalido", error);
      }
    }
  }
}
