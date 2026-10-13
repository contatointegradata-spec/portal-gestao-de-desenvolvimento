import { reactive } from "vue";
import { http } from "../lib/api.js";

export const SECRET_MASK = "__SECRET_UNCHANGED__";

export const apiState = reactive({
  collections: [],
  collectionsLoaded: false,
  collectionsLoading: false,
  current: null, // { collection, folders, requests, environments }
  treeLoading: false,
  selectedRequestId: null,
  originals: {},
  drafts: {},
  responses: {},
  sending: {},
  environmentId: null
});

const EDITABLE_FIELDS = ["name", "description", "method", "url", "queryParams", "headers", "bodyType", "bodyContent", "formFields", "authType", "authConfig", "settings", "postResponse"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function comparable(request) {
  if (!request) return "";
  const clean = (list) => (list || []).filter((item) => String(item.key || "").trim() || String(item.value || "").trim());
  return JSON.stringify({
    ...Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, request[field]])),
    queryParams: clean(request.queryParams),
    headers: clean(request.headers),
    formFields: clean(request.formFields)
  });
}

function envStorageKey(collectionId) {
  return `gestao_api_env_${collectionId}`;
}

export async function loadCollections() {
  apiState.collectionsLoading = true;
  try {
    apiState.collections = await http.get("/api/apis/collections");
    apiState.collectionsLoaded = true;
  } finally {
    apiState.collectionsLoading = false;
  }
}

export async function openCollection(collectionId) {
  if (apiState.current?.collection.id === collectionId) return;
  apiState.treeLoading = true;
  try {
    const data = await http.get(`/api/apis/collections/${collectionId}`);
    apiState.current = data;
    apiState.selectedRequestId = null;
    let stored = null;
    try { stored = localStorage.getItem(envStorageKey(collectionId)); } catch { stored = null; }
    const valid = (id) => id && data.environments.some((environment) => environment.id === id);
    apiState.environmentId = stored === "none" ? null : valid(stored) ? stored : data.collection.activeEnvironmentId || data.environments[0]?.id || null;
  } finally {
    apiState.treeLoading = false;
  }
}

export async function reloadTree() {
  if (!apiState.current) return;
  const data = await http.get(`/api/apis/collections/${apiState.current.collection.id}`);
  apiState.current = data;
  if (apiState.environmentId && !data.environments.some((environment) => environment.id === apiState.environmentId)) {
    apiState.environmentId = data.environments[0]?.id || null;
  }
  const collectionIndex = apiState.collections.findIndex((item) => item.id === data.collection.id);
  if (collectionIndex >= 0) apiState.collections[collectionIndex] = data.collection;
}

export function closeCollection() {
  apiState.current = null;
  apiState.selectedRequestId = null;
}

export function setEnvironment(environmentId) {
  apiState.environmentId = environmentId || null;
  if (!apiState.current) return;
  try {
    localStorage.setItem(envStorageKey(apiState.current.collection.id), environmentId || "none");
  } catch {
    // armazenamento indisponivel
  }
}

export async function ensureRequestLoaded(requestId, { force = false } = {}) {
  if (!force && apiState.originals[requestId]) return apiState.drafts[requestId];
  const request = await http.get(`/api/apis/requests/${requestId}`);
  apiState.originals[requestId] = request;
  if (force || !apiState.drafts[requestId]) apiState.drafts[requestId] = clone(request);
  return apiState.drafts[requestId];
}

export function isDirty(requestId) {
  const draft = apiState.drafts[requestId];
  const original = apiState.originals[requestId];
  return Boolean(draft && original && comparable(draft) !== comparable(original));
}

export function hasDirtyDrafts() {
  return Object.keys(apiState.drafts).some(isDirty);
}

export function discardDraft(requestId) {
  if (apiState.originals[requestId]) apiState.drafts[requestId] = clone(apiState.originals[requestId]);
}

function draftPayload(draft) {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, draft[field]]));
}

export async function saveRequest(requestId) {
  const draft = apiState.drafts[requestId];
  const saved = await http.patch(`/api/apis/requests/${requestId}`, draftPayload(draft));
  apiState.originals[requestId] = saved;
  apiState.drafts[requestId] = clone(saved);
  const summary = apiState.current?.requests.find((item) => item.id === requestId);
  if (summary) Object.assign(summary, { name: saved.name, method: saved.method, url: saved.url });
  return saved;
}

export async function sendRequest(requestId, { forceTokenRefresh = false } = {}) {
  const draft = apiState.drafts[requestId];
  apiState.sending[requestId] = true;
  try {
    const result = await http.post(`/api/apis/requests/${requestId}/send`, {
      draft: { ...draftPayload(draft), folderId: draft.folderId },
      environmentId: apiState.environmentId,
      forceTokenRefresh
    });
    apiState.responses[requestId] = { ...result, receivedAt: new Date().toISOString() };
    if (result.environment && apiState.current) {
      const index = apiState.current.environments.findIndex((item) => item.id === result.environment.id);
      if (index >= 0) apiState.current.environments[index] = result.environment;
    }
    return result;
  } finally {
    apiState.sending[requestId] = false;
  }
}

export function forgetRequest(requestId) {
  delete apiState.originals[requestId];
  delete apiState.drafts[requestId];
  delete apiState.responses[requestId];
  if (apiState.selectedRequestId === requestId) apiState.selectedRequestId = null;
}

export function currentEnvironment() {
  return apiState.current?.environments.find((item) => item.id === apiState.environmentId) || null;
}

/** Fonte da autenticacao herdada para uma pasta (ou raiz). */
export function inheritedAuth(folderId) {
  const folders = apiState.current?.folders || [];
  let currentId = folderId;
  for (let depth = 0; currentId && depth < 30; depth += 1) {
    const folder = folders.find((item) => item.id === currentId);
    if (!folder) break;
    if (folder.authType && folder.authType !== "inherit") return { type: folder.authType, source: `pasta "${folder.name}"` };
    currentId = folder.parentId;
  }
  return { type: apiState.current?.collection.authType || "none", source: "colecao" };
}

export function folderPath(folderId) {
  const folders = apiState.current?.folders || [];
  const path = [];
  let currentId = folderId;
  for (let depth = 0; currentId && depth < 30; depth += 1) {
    const folder = folders.find((item) => item.id === currentId);
    if (!folder) break;
    path.unshift(folder.name);
    currentId = folder.parentId;
  }
  return path;
}
