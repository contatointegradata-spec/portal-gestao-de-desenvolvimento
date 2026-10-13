import crypto from "node:crypto";
import { getDb, withTransaction } from "../db.js";
import { requireAuth, requireManager } from "../lib/auth.js";
import { asyncRouter, badRequest, HttpError, notFound, nowIso, parseJson, trimText, truncate } from "../lib/http.js";
import { BODY_TYPES, executeRequest, extractValues, HTTP_METHODS } from "../apis/executor.js";
import {
  maskAuthConfig, maskVariables, normalizeAuthType, prepareAuthConfigForStorage, prepareVariablesForStorage,
  resolveDraftAuthConfig, revealAuthConfig, revealVariables
} from "../apis/secrets.js";
import { exportPostman, parseCurl, parseImport } from "../apis/transfer.js";

const router = asyncRouter();
const SCOPES = ["internal", "external"];
const MAX_HISTORY_PER_REQUEST = 100;
const MAX_HISTORY_BODY = 256 * 1024;

// ─── Normalizacao ─────────────────────────────────────────────────────────────
function normalizeKv(list) {
  return (Array.isArray(list) ? list : []).slice(0, 200).map((item) => ({
    key: String(item?.key ?? ""),
    value: String(item?.value ?? ""),
    enabled: item?.enabled !== false,
    ...(item?.description ? { description: String(item.description).slice(0, 300) } : {})
  })).filter((item) => item.key.trim() || item.value.trim());
}

function normalizeSettings(settings, existing = {}) {
  const source = { ...existing, ...(settings && typeof settings === "object" ? settings : {}) };
  return {
    timeoutMs: Math.min(Math.max(Number(source.timeoutMs) || 30000, 1000), 300000),
    followRedirects: source.followRedirects !== false,
    insecureTls: Boolean(source.insecureTls)
  };
}

function normalizeRules(rules) {
  return (Array.isArray(rules) ? rules : []).slice(0, 30).map((rule) => ({
    id: String(rule?.id || crypto.randomUUID()),
    enabled: rule?.enabled !== false,
    source: ["body", "header", "status"].includes(rule?.source) ? rule.source : "body",
    path: String(rule?.path ?? "").trim(),
    variable: String(rule?.variable ?? "").trim(),
    secret: Boolean(rule?.secret)
  })).filter((rule) => rule.variable);
}

// ─── Serializacao ─────────────────────────────────────────────────────────────
function serializeCollection(row) {
  const { config, secretsFilled } = maskAuthConfig(row.authType, parseJson(row.authConfig, {}));
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    scope: SCOPES.includes(row.scope) ? row.scope : "external",
    authType: row.authType || "none",
    authConfig: config,
    authSecretsFilled: secretsFilled,
    activeEnvironmentId: row.activeEnvironmentId || null,
    sortOrder: row.sortOrder || 0,
    folderCount: Number(row.folderCount || 0),
    requestCount: Number(row.requestCount || 0),
    environmentCount: Number(row.environmentCount || 0),
    createdByName: row.createdByName || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function serializeFolder(row) {
  const { config, secretsFilled } = maskAuthConfig(row.authType, parseJson(row.authConfig, {}));
  return {
    id: row.id,
    collectionId: row.collectionId,
    parentId: row.parentId || null,
    name: row.name,
    description: row.description || "",
    authType: row.authType || "inherit",
    authConfig: config,
    authSecretsFilled: secretsFilled,
    sortOrder: row.sortOrder || 0
  };
}

function serializeRequestSummary(row) {
  return { id: row.id, collectionId: row.collectionId, folderId: row.folderId || null, name: row.name, method: row.method, url: row.url, sortOrder: row.sortOrder || 0, updatedAt: row.updatedAt };
}

function serializeRequest(row) {
  const { config, secretsFilled } = maskAuthConfig(row.authType, parseJson(row.authConfig, {}));
  return {
    ...serializeRequestSummary(row),
    description: row.description || "",
    queryParams: parseJson(row.queryParams, []),
    headers: parseJson(row.headers, []),
    bodyType: BODY_TYPES.includes(row.bodyType) ? row.bodyType : "none",
    bodyContent: row.bodyContent || "",
    formFields: parseJson(row.formFields, []),
    authType: row.authType || "inherit",
    authConfig: config,
    authSecretsFilled: secretsFilled,
    settings: normalizeSettings(parseJson(row.settings, {})),
    postResponse: normalizeRules(parseJson(row.postResponse, [])),
    createdAt: row.createdAt
  };
}

function serializeEnvironment(row) {
  return {
    id: row.id,
    collectionId: row.collectionId,
    name: row.name,
    variables: maskVariables(parseJson(row.variables, [])),
    sortOrder: row.sortOrder || 0,
    updatedAt: row.updatedAt
  };
}

// ─── Carregamento ─────────────────────────────────────────────────────────────
const COLLECTION_SELECT = `
  SELECT c.*, u.nome AS createdByName,
    (SELECT COUNT(*) FROM api_folders f WHERE f.collectionId = c.id) AS folderCount,
    (SELECT COUNT(*) FROM api_requests r WHERE r.collectionId = c.id) AS requestCount,
    (SELECT COUNT(*) FROM api_environments e WHERE e.collectionId = c.id) AS environmentCount
  FROM api_collections c LEFT JOIN users u ON u.id = c.createdByUserId
`;

async function getCollection(db, id) {
  const row = await db.get(`${COLLECTION_SELECT} WHERE c.id = ?`, id);
  if (!row) throw notFound("Colecao nao encontrada.");
  return row;
}

async function getFolder(db, id) {
  const row = await db.get("SELECT * FROM api_folders WHERE id = ?", id);
  if (!row) throw notFound("Pasta nao encontrada.");
  return row;
}

async function getRequest(db, id) {
  const row = await db.get("SELECT * FROM api_requests WHERE id = ?", id);
  if (!row) throw notFound("Requisicao nao encontrada.");
  return row;
}

async function getEnvironment(db, id) {
  const row = await db.get("SELECT * FROM api_environments WHERE id = ?", id);
  if (!row) throw notFound("Ambiente nao encontrado.");
  return row;
}

async function nextSortOrder(db, table, where, ...params) {
  const row = await db.get(`SELECT COALESCE(MAX(sortOrder), -1) + 1 AS next FROM ${table} WHERE ${where}`, ...params);
  return Number(row?.next || 0);
}

async function assertFolderInCollection(db, folderId, collectionId) {
  if (!folderId) return null;
  const folder = await db.get("SELECT id FROM api_folders WHERE id = ? AND collectionId = ?", folderId, collectionId);
  if (!folder) throw badRequest("Pasta de destino invalida para esta colecao.");
  return folder.id;
}

async function touchCollection(db, collectionId) {
  await db.run("UPDATE api_collections SET updatedAt = ? WHERE id = ?", nowIso(), collectionId);
}

/** Resolve a autenticacao efetiva: requisicao -> pastas ancestrais -> colecao. */
async function resolveEffectiveAuth(db, { authType, authConfigStored, draftAuthConfig, folderId, collection }) {
  const type = normalizeAuthType(authType);
  if (type !== "inherit") {
    const config = draftAuthConfig ? resolveDraftAuthConfig(type, draftAuthConfig, authConfigStored) : revealAuthConfig(type, authConfigStored);
    return { type, config, source: "Requisicao" };
  }
  let currentId = folderId;
  for (let depth = 0; currentId && depth < 30; depth += 1) {
    const folder = await db.get("SELECT * FROM api_folders WHERE id = ?", currentId);
    if (!folder) break;
    if (folder.authType && folder.authType !== "inherit") {
      return { type: folder.authType, config: revealAuthConfig(folder.authType, parseJson(folder.authConfig, {})), source: `Pasta "${folder.name}"` };
    }
    currentId = folder.parentId;
  }
  const collectionType = normalizeAuthType(collection.authType, { allowInherit: false });
  return { type: collectionType, config: revealAuthConfig(collectionType, parseJson(collection.authConfig, {})), source: "Colecao" };
}

// ─── Colecoes ─────────────────────────────────────────────────────────────────
router.get("/collections", requireAuth, async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`${COLLECTION_SELECT} ORDER BY c.sortOrder ASC, c.name COLLATE NOCASE ASC`);
  res.json(rows.map(serializeCollection));
});

router.post("/collections", requireManager, async (req, res) => {
  const name = trimText(req.body?.name);
  if (!name) throw badRequest("Informe o nome da colecao.");
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const authType = normalizeAuthType(req.body?.authType || "none", { allowInherit: false });
  await db.run(
    `INSERT INTO api_collections (id, name, description, scope, authType, authConfig, activeEnvironmentId, sortOrder, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    id, name, trimText(req.body?.description), SCOPES.includes(req.body?.scope) ? req.body.scope : "external", authType,
    JSON.stringify(prepareAuthConfigForStorage(authType, req.body?.authConfig, {})), await nextSortOrder(db, "api_collections", "1 = 1"),
    req.user.id, now, now
  );
  res.status(201).json(serializeCollection(await getCollection(db, id)));
});

router.get("/collections/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.params.id);
  const [folders, requests, environments] = await Promise.all([
    db.all("SELECT * FROM api_folders WHERE collectionId = ? ORDER BY sortOrder ASC, name COLLATE NOCASE ASC", collection.id),
    db.all("SELECT id, collectionId, folderId, name, method, url, sortOrder, updatedAt FROM api_requests WHERE collectionId = ? ORDER BY sortOrder ASC, name COLLATE NOCASE ASC", collection.id),
    db.all("SELECT * FROM api_environments WHERE collectionId = ? ORDER BY sortOrder ASC, name COLLATE NOCASE ASC", collection.id)
  ]);
  res.json({
    collection: serializeCollection(collection),
    folders: folders.map(serializeFolder),
    requests: requests.map(serializeRequestSummary),
    environments: environments.map(serializeEnvironment)
  });
});

router.patch("/collections/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.params.id);
  const payload = req.body || {};
  const name = payload.name !== undefined ? trimText(payload.name) : collection.name;
  if (!name) throw badRequest("Informe o nome da colecao.");
  const authType = payload.authType !== undefined ? normalizeAuthType(payload.authType, { allowInherit: false }) : collection.authType;
  const authConfig = payload.authType !== undefined || payload.authConfig !== undefined
    ? prepareAuthConfigForStorage(authType, payload.authConfig, authType === collection.authType ? parseJson(collection.authConfig, {}) : {})
    : parseJson(collection.authConfig, {});
  let activeEnvironmentId = collection.activeEnvironmentId;
  if (payload.activeEnvironmentId !== undefined) {
    activeEnvironmentId = payload.activeEnvironmentId || null;
    if (activeEnvironmentId && !(await db.get("SELECT id FROM api_environments WHERE id = ? AND collectionId = ?", activeEnvironmentId, collection.id))) {
      throw badRequest("Ambiente invalido para esta colecao.");
    }
  }
  await db.run(
    "UPDATE api_collections SET name = ?, description = ?, scope = ?, authType = ?, authConfig = ?, activeEnvironmentId = ?, updatedAt = ? WHERE id = ?",
    name, payload.description !== undefined ? trimText(payload.description) : collection.description,
    SCOPES.includes(payload.scope) ? payload.scope : collection.scope, authType, JSON.stringify(authConfig), activeEnvironmentId, nowIso(), collection.id
  );
  res.json(serializeCollection(await getCollection(db, collection.id)));
});

router.delete("/collections/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.params.id);
  await withTransaction(db, async () => {
    await db.run("DELETE FROM api_request_history WHERE collectionId = ?", collection.id);
    await db.run("DELETE FROM api_requests WHERE collectionId = ?", collection.id);
    await db.run("DELETE FROM api_folders WHERE collectionId = ?", collection.id);
    await db.run("DELETE FROM api_environments WHERE collectionId = ?", collection.id);
    await db.run("DELETE FROM api_collections WHERE id = ?", collection.id);
  });
  res.status(204).send();
});

router.get("/collections/:id/export", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.params.id);
  const folders = (await db.all("SELECT * FROM api_folders WHERE collectionId = ?", collection.id)).map(serializeFolder);
  const requests = (await db.all("SELECT * FROM api_requests WHERE collectionId = ?", collection.id)).map(serializeRequest);
  const environments = (await db.all("SELECT * FROM api_environments WHERE collectionId = ? ORDER BY sortOrder", collection.id)).map(serializeEnvironment);
  res.json(exportPostman({ collection: serializeCollection(collection), folders, requests, environments }));
});

/** Reordena/move pastas e requisicoes (arrastar e soltar na arvore). */
router.post("/collections/:id/reorder", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.params.id);
  const folderUpdates = Array.isArray(req.body?.folders) ? req.body.folders : [];
  const requestUpdates = Array.isArray(req.body?.requests) ? req.body.requests : [];
  const folders = await db.all("SELECT id, parentId FROM api_folders WHERE collectionId = ?", collection.id);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const parents = new Map(folders.map((folder) => [folder.id, folder.parentId || null]));
  for (const update of folderUpdates) {
    if (!folderIds.has(update.id)) throw badRequest("Pasta invalida na reordenacao.");
    const parentId = update.parentId || null;
    if (parentId && !folderIds.has(parentId)) throw badRequest("Pasta de destino invalida.");
    parents.set(update.id, parentId);
  }
  // Impede ciclos (pasta dentro dela mesma)
  for (const id of folderIds) {
    const seen = new Set();
    let current = id;
    while (current) {
      if (seen.has(current)) throw badRequest("Nao e possivel mover uma pasta para dentro dela mesma.");
      seen.add(current);
      current = parents.get(current);
    }
  }
  await withTransaction(db, async () => {
    for (const update of folderUpdates) {
      await db.run("UPDATE api_folders SET parentId = ?, sortOrder = ?, updatedAt = ? WHERE id = ? AND collectionId = ?",
        update.parentId || null, Number(update.sortOrder) || 0, nowIso(), update.id, collection.id);
    }
    for (const update of requestUpdates) {
      if (update.folderId && !folderIds.has(update.folderId)) throw badRequest("Pasta de destino invalida.");
      await db.run("UPDATE api_requests SET folderId = ?, sortOrder = ?, updatedAt = ? WHERE id = ? AND collectionId = ?",
        update.folderId || null, Number(update.sortOrder) || 0, nowIso(), update.id, collection.id);
    }
  });
  await touchCollection(db, collection.id);
  res.json({ ok: true });
});

// ─── Pastas ───────────────────────────────────────────────────────────────────
router.post("/folders", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.body?.collectionId);
  const name = trimText(req.body?.name);
  if (!name) throw badRequest("Informe o nome da pasta.");
  const parentId = await assertFolderInCollection(db, req.body?.parentId, collection.id);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO api_folders (id, collectionId, parentId, name, description, authType, authConfig, sortOrder, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'inherit', '{}', ?, ?, ?)`,
    id, collection.id, parentId, name, trimText(req.body?.description),
    await nextSortOrder(db, "api_folders", "collectionId = ? AND COALESCE(parentId, '') = ?", collection.id, parentId || ""), now, now
  );
  await touchCollection(db, collection.id);
  res.status(201).json(serializeFolder(await getFolder(db, id)));
});

router.get("/folders/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  res.json(serializeFolder(await getFolder(db, req.params.id)));
});

router.patch("/folders/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const folder = await getFolder(db, req.params.id);
  const payload = req.body || {};
  const name = payload.name !== undefined ? trimText(payload.name) : folder.name;
  if (!name) throw badRequest("Informe o nome da pasta.");
  const authType = payload.authType !== undefined ? normalizeAuthType(payload.authType) : folder.authType;
  const authConfig = payload.authType !== undefined || payload.authConfig !== undefined
    ? prepareAuthConfigForStorage(authType, payload.authConfig, authType === folder.authType ? parseJson(folder.authConfig, {}) : {})
    : parseJson(folder.authConfig, {});
  await db.run(
    "UPDATE api_folders SET name = ?, description = ?, authType = ?, authConfig = ?, updatedAt = ? WHERE id = ?",
    name, payload.description !== undefined ? trimText(payload.description) : folder.description, authType, JSON.stringify(authConfig), nowIso(), folder.id
  );
  await touchCollection(db, folder.collectionId);
  res.json(serializeFolder(await getFolder(db, folder.id)));
});

router.delete("/folders/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const folder = await getFolder(db, req.params.id);
  const all = await db.all("SELECT id, parentId FROM api_folders WHERE collectionId = ?", folder.collectionId);
  const subtree = new Set([folder.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of all) {
      if (item.parentId && subtree.has(item.parentId) && !subtree.has(item.id)) {
        subtree.add(item.id);
        changed = true;
      }
    }
  }
  const ids = [...subtree];
  const placeholders = ids.map(() => "?").join(", ");
  const count = await db.get(`SELECT COUNT(*) AS total FROM api_requests WHERE folderId IN (${placeholders})`, ...ids);
  await withTransaction(db, async () => {
    await db.run(`DELETE FROM api_requests WHERE folderId IN (${placeholders})`, ...ids);
    await db.run("DELETE FROM api_folders WHERE id = ?", folder.id);
  });
  await touchCollection(db, folder.collectionId);
  res.json({ deletedFolders: ids.length, deletedRequests: Number(count?.total || 0) });
});

// ─── Requisicoes ──────────────────────────────────────────────────────────────
async function buildRequestRecord(db, payload, existing, collectionId) {
  const pick = (key, fallback) => (payload[key] !== undefined ? payload[key] : fallback);
  const name = trimText(pick("name", existing?.name || "Nova requisicao"));
  if (!name) throw badRequest("Informe o nome da requisicao.");
  const method = String(pick("method", existing?.method || "GET")).toUpperCase();
  if (!HTTP_METHODS.includes(method)) throw badRequest("Metodo HTTP invalido.");
  const bodyType = pick("bodyType", existing?.bodyType || "none");
  if (!BODY_TYPES.includes(bodyType)) throw badRequest("Tipo de corpo invalido.");
  const authType = normalizeAuthType(pick("authType", existing?.authType || "inherit"));
  const storedAuth = parseJson(existing?.authConfig, {});
  const authConfig = payload.authType !== undefined || payload.authConfig !== undefined
    ? prepareAuthConfigForStorage(authType, pick("authConfig", {}), authType === existing?.authType ? storedAuth : {})
    : storedAuth;
  const folderId = payload.folderId !== undefined ? await assertFolderInCollection(db, payload.folderId, collectionId) : existing?.folderId || null;
  const bodyContent = String(pick("bodyContent", existing?.bodyContent || ""));
  if (bodyContent.length > 2_000_000) throw badRequest("O corpo da requisicao excede 2 MB.");
  return {
    name,
    description: String(pick("description", existing?.description || "")).slice(0, 20000),
    method,
    url: String(pick("url", existing?.url || "")).trim(),
    queryParams: normalizeKv(pick("queryParams", parseJson(existing?.queryParams, []))),
    headers: normalizeKv(pick("headers", parseJson(existing?.headers, []))),
    bodyType,
    bodyContent,
    formFields: normalizeKv(pick("formFields", parseJson(existing?.formFields, []))),
    authType,
    authConfig,
    settings: normalizeSettings(payload.settings, parseJson(existing?.settings, {})),
    postResponse: normalizeRules(pick("postResponse", parseJson(existing?.postResponse, []))),
    folderId
  };
}

router.post("/requests", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.body?.collectionId);
  const record = await buildRequestRecord(db, req.body || {}, null, collection.id);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO api_requests (id, collectionId, folderId, name, description, method, url, queryParams, headers, bodyType, bodyContent, formFields,
       authType, authConfig, settings, postResponse, sortOrder, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, collection.id, record.folderId, record.name, record.description, record.method, record.url, JSON.stringify(record.queryParams),
    JSON.stringify(record.headers), record.bodyType, record.bodyContent, JSON.stringify(record.formFields), record.authType,
    JSON.stringify(record.authConfig), JSON.stringify(record.settings), JSON.stringify(record.postResponse),
    await nextSortOrder(db, "api_requests", "collectionId = ? AND COALESCE(folderId, '') = ?", collection.id, record.folderId || ""),
    req.user.id, now, now
  );
  await touchCollection(db, collection.id);
  res.status(201).json(serializeRequest(await getRequest(db, id)));
});

router.get("/requests/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  res.json(serializeRequest(await getRequest(db, req.params.id)));
});

router.patch("/requests/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await getRequest(db, req.params.id);
  const record = await buildRequestRecord(db, req.body || {}, existing, existing.collectionId);
  await db.run(
    `UPDATE api_requests SET folderId = ?, name = ?, description = ?, method = ?, url = ?, queryParams = ?, headers = ?, bodyType = ?, bodyContent = ?,
       formFields = ?, authType = ?, authConfig = ?, settings = ?, postResponse = ?, updatedAt = ? WHERE id = ?`,
    record.folderId, record.name, record.description, record.method, record.url, JSON.stringify(record.queryParams), JSON.stringify(record.headers),
    record.bodyType, record.bodyContent, JSON.stringify(record.formFields), record.authType, JSON.stringify(record.authConfig),
    JSON.stringify(record.settings), JSON.stringify(record.postResponse), nowIso(), existing.id
  );
  await touchCollection(db, existing.collectionId);
  res.json(serializeRequest(await getRequest(db, existing.id)));
});

router.delete("/requests/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const existing = await getRequest(db, req.params.id);
  await db.run("DELETE FROM api_request_history WHERE requestId = ?", existing.id);
  await db.run("DELETE FROM api_requests WHERE id = ?", existing.id);
  await touchCollection(db, existing.collectionId);
  res.status(204).send();
});

router.post("/requests/:id/duplicate", requireManager, async (req, res) => {
  const db = await getDb();
  const source = await getRequest(db, req.params.id);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run("UPDATE api_requests SET sortOrder = sortOrder + 1 WHERE collectionId = ? AND COALESCE(folderId, '') = ? AND sortOrder > ?",
    source.collectionId, source.folderId || "", source.sortOrder || 0);
  await db.run(
    `INSERT INTO api_requests (id, collectionId, folderId, name, description, method, url, queryParams, headers, bodyType, bodyContent, formFields,
       authType, authConfig, settings, postResponse, sortOrder, createdByUserId, createdAt, updatedAt)
     SELECT ?, collectionId, folderId, substr(name || ' (copia)', 1, 200), description, method, url, queryParams, headers, bodyType, bodyContent, formFields,
       authType, authConfig, settings, postResponse, sortOrder + 1, ?, ?, ? FROM api_requests WHERE id = ?`,
    id, req.user.id, now, now, source.id
  );
  await touchCollection(db, source.collectionId);
  res.status(201).json(serializeRequest(await getRequest(db, id)));
});

/**
 * Envia a requisicao. Aceita um rascunho (alteracoes nao salvas) para testar
 * antes de salvar; segredos mascarados sao completados com os valores salvos.
 */
router.post("/requests/:id/send", requireAuth, async (req, res) => {
  const db = await getDb();
  const stored = await getRequest(db, req.params.id);
  const collection = await getCollection(db, stored.collectionId);
  const draft = req.body?.draft && typeof req.body.draft === "object" ? req.body.draft : null;
  const source = draft || {};
  const pick = (key, fallback) => (source[key] !== undefined ? source[key] : fallback);

  const request = {
    method: pick("method", stored.method),
    url: pick("url", stored.url),
    queryParams: normalizeKv(pick("queryParams", parseJson(stored.queryParams, []))),
    headers: normalizeKv(pick("headers", parseJson(stored.headers, []))),
    bodyType: pick("bodyType", stored.bodyType),
    bodyContent: pick("bodyContent", stored.bodyContent || ""),
    formFields: normalizeKv(pick("formFields", parseJson(stored.formFields, []))),
    settings: normalizeSettings(source.settings, parseJson(stored.settings, {})),
    forceTokenRefresh: Boolean(req.body?.forceTokenRefresh)
  };
  const authType = normalizeAuthType(pick("authType", stored.authType));
  const auth = await resolveEffectiveAuth(db, {
    authType,
    authConfigStored: authType === stored.authType ? parseJson(stored.authConfig, {}) : {},
    draftAuthConfig: draft ? pick("authConfig", {}) : null,
    folderId: pick("folderId", stored.folderId),
    collection
  });

  const environmentId = req.body?.environmentId === undefined ? collection.activeEnvironmentId : req.body.environmentId;
  const environment = environmentId ? await db.get("SELECT * FROM api_environments WHERE id = ? AND collectionId = ?", environmentId, collection.id) : null;
  const storedVariables = parseJson(environment?.variables, []);

  let result;
  let errorMessage = "";
  const started = Date.now();
  try {
    result = await executeRequest({ request, auth, variables: revealVariables(storedVariables) });
  } catch (error) {
    if (error.status === 400) throw badRequest(error.message);
    errorMessage = error.message || "Falha ao executar a requisicao.";
  }

  // Extracao de variaveis apos a resposta
  let extraction = [];
  let updatedEnvironment = null;
  const rules = normalizeRules(pick("postResponse", parseJson(stored.postResponse, [])));
  if (result && rules.length) {
    extraction = extractValues(rules, result);
    const successful = extraction.filter((item) => item.ok);
    if (successful.length && !environment) {
      extraction = extraction.map((item) => (item.ok ? { ...item, ok: false, error: "Selecione um ambiente para salvar as variaveis extraidas." } : item));
    } else if (successful.length) {
      const plain = revealVariables(storedVariables);
      for (const item of successful) {
        const current = plain.find((variable) => variable.key === item.variable);
        if (current) current.value = item.value;
        else plain.push({ key: item.variable, value: item.value, secret: item.secret, enabled: true });
      }
      const prepared = prepareVariablesForStorage(plain, []);
      await db.run("UPDATE api_environments SET variables = ?, updatedAt = ? WHERE id = ?", JSON.stringify(prepared), nowIso(), environment.id);
      updatedEnvironment = serializeEnvironment(await getEnvironment(db, environment.id));
      extraction = extraction.map((item) => {
        if (!item.ok) return item;
        const variable = prepared.find((entry) => entry.key === item.variable);
        return { variable: item.variable, ok: true, value: variable?.secret ? "••••••" : truncate(item.value, 200) };
      });
    }
  }

  const historyId = crypto.randomUUID();
  await db.run(
    `INSERT INTO api_request_history (id, requestId, collectionId, executedByUserId, method, url, requestHeaders, requestBody, statusCode, statusText,
       durationMs, responseSize, responseHeaders, responseBody, errorMessage, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    historyId, stored.id, collection.id, req.user.id,
    result?.request.method || String(request.method).toUpperCase(), result?.request.url || String(request.url),
    JSON.stringify(result?.request.headers || {}), truncate(result?.request.body || "", 20000),
    result?.statusCode ?? null, result?.statusText || "", result?.durationMs ?? Date.now() - started, result?.size ?? 0,
    JSON.stringify(result?.headers || {}), result ? (result.bodyEncoding === "utf8" ? truncate(result.body, MAX_HISTORY_BODY) : "[conteudo binario]") : "",
    errorMessage, nowIso()
  );
  await db.run(
    `DELETE FROM api_request_history WHERE requestId = ? AND id NOT IN (
       SELECT id FROM api_request_history WHERE requestId = ? ORDER BY createdAt DESC LIMIT ?)`,
    stored.id, stored.id, MAX_HISTORY_PER_REQUEST
  );

  if (!result) {
    return res.json({ ok: false, historyId, errorMessage, durationMs: Date.now() - started, auth: { type: auth.type, source: auth.source } });
  }
  const { bodyText, ...publicResult } = result;
  res.json({ ok: true, historyId, ...publicResult, extraction, environment: updatedEnvironment, environmentName: environment?.name || "" });
});

router.get("/requests/:id/history", requireAuth, async (req, res) => {
  const db = await getDb();
  const request = await getRequest(db, req.params.id);
  const rows = await db.all(
    `SELECT h.id, h.method, h.url, h.statusCode, h.statusText, h.durationMs, h.responseSize, h.errorMessage, h.createdAt, u.nome AS executedByName
     FROM api_request_history h LEFT JOIN users u ON u.id = h.executedByUserId
     WHERE h.requestId = ? ORDER BY h.createdAt DESC LIMIT ?`,
    request.id, MAX_HISTORY_PER_REQUEST
  );
  res.json(rows);
});

router.delete("/requests/:id/history", requireManager, async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM api_request_history WHERE requestId = ?", req.params.id);
  res.status(204).send();
});

router.get("/history/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const row = await db.get(
    "SELECT h.*, u.nome AS executedByName FROM api_request_history h LEFT JOIN users u ON u.id = h.executedByUserId WHERE h.id = ?",
    req.params.id
  );
  if (!row) throw notFound("Registro de historico nao encontrado.");
  res.json({
    ...row,
    requestHeaders: parseJson(row.requestHeaders, {}),
    responseHeaders: parseJson(row.responseHeaders, {})
  });
});

// ─── Ambientes ────────────────────────────────────────────────────────────────
router.post("/environments", requireManager, async (req, res) => {
  const db = await getDb();
  const collection = await getCollection(db, req.body?.collectionId);
  const name = trimText(req.body?.name);
  if (!name) throw badRequest("Informe o nome do ambiente.");
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    "INSERT INTO api_environments (id, collectionId, name, variables, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, collection.id, name, JSON.stringify(prepareVariablesForStorage(req.body?.variables, [])),
    await nextSortOrder(db, "api_environments", "collectionId = ?", collection.id), now, now
  );
  if (!collection.activeEnvironmentId) await db.run("UPDATE api_collections SET activeEnvironmentId = ? WHERE id = ?", id, collection.id);
  await touchCollection(db, collection.id);
  res.status(201).json(serializeEnvironment(await getEnvironment(db, id)));
});

router.patch("/environments/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const environment = await getEnvironment(db, req.params.id);
  const name = req.body?.name !== undefined ? trimText(req.body.name) : environment.name;
  if (!name) throw badRequest("Informe o nome do ambiente.");
  const variables = req.body?.variables !== undefined
    ? prepareVariablesForStorage(req.body.variables, parseJson(environment.variables, []))
    : parseJson(environment.variables, []);
  await db.run("UPDATE api_environments SET name = ?, variables = ?, updatedAt = ? WHERE id = ?", name, JSON.stringify(variables), nowIso(), environment.id);
  await touchCollection(db, environment.collectionId);
  res.json(serializeEnvironment(await getEnvironment(db, environment.id)));
});

router.delete("/environments/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const environment = await getEnvironment(db, req.params.id);
  await db.run("DELETE FROM api_environments WHERE id = ?", environment.id);
  await db.run("UPDATE api_collections SET activeEnvironmentId = NULL WHERE activeEnvironmentId = ?", environment.id);
  await touchCollection(db, environment.collectionId);
  res.status(204).send();
});

/** Revela segredos (somente Admin/Super Admin). */
router.post("/reveal", requireManager, async (req, res) => {
  const db = await getDb();
  const target = String(req.body?.target || "");
  const id = String(req.body?.id || "");
  if (target === "environment") {
    const environment = await getEnvironment(db, id);
    return res.json({ variables: revealVariables(parseJson(environment.variables, [])) });
  }
  const table = { collection: "api_collections", folder: "api_folders", request: "api_requests" }[target];
  if (!table) throw badRequest("Alvo invalido.");
  const row = await db.get(`SELECT authType, authConfig FROM ${table} WHERE id = ?`, id);
  if (!row) throw notFound();
  res.json({ authConfig: revealAuthConfig(row.authType, parseJson(row.authConfig, {})) });
});

// ─── Importacao ───────────────────────────────────────────────────────────────
router.post("/parse-curl", requireAuth, async (req, res) => {
  try {
    res.json(parseCurl(req.body?.command));
  } catch (error) {
    throw badRequest(error.message);
  }
});

router.post("/import", requireManager, async (req, res) => {
  let parsed;
  try {
    parsed = parseImport(req.body?.content);
  } catch (error) {
    throw badRequest(error.message);
  }
  const db = await getDb();
  const targetCollectionId = trimText(req.body?.targetCollectionId);
  if (targetCollectionId) await getCollection(db, targetCollectionId);
  const created = [];
  let requestCount = 0;

  await withTransaction(db, async () => {
    for (const item of parsed.collections) {
      const now = nowIso();
      let collectionId = targetCollectionId;
      if (!collectionId) {
        collectionId = crypto.randomUUID();
        const authType = normalizeAuthType(item.authType, { allowInherit: false });
        await db.run(
          `INSERT INTO api_collections (id, name, description, scope, authType, authConfig, activeEnvironmentId, sortOrder, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, 'external', ?, ?, NULL, ?, ?, ?, ?)`,
          collectionId, item.name, item.description || "", authType, JSON.stringify(prepareAuthConfigForStorage(authType, item.authConfig, {})),
          await nextSortOrder(db, "api_collections", "1 = 1"), req.user.id, now, now
        );
      }
      const folderIds = new Map();
      for (const folder of item.folders) {
        const id = crypto.randomUUID();
        folderIds.set(folder.ref, id);
        const authType = normalizeAuthType(folder.authType);
        await db.run(
          `INSERT INTO api_folders (id, collectionId, parentId, name, description, authType, authConfig, sortOrder, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, collectionId, folder.parentRef ? folderIds.get(folder.parentRef) || null : null, folder.name, folder.description || "",
          authType, JSON.stringify(prepareAuthConfigForStorage(authType, folder.authConfig, {})), folder.sortOrder || 0, now, now
        );
      }
      let rootOrder = await nextSortOrder(db, "api_requests", "collectionId = ? AND folderId IS NULL", collectionId);
      for (const request of item.requests) {
        const record = await buildRequestRecord(db, { ...request, folderId: undefined }, null, collectionId);
        const folderId = request.folderRef ? folderIds.get(request.folderRef) || null : null;
        await db.run(
          `INSERT INTO api_requests (id, collectionId, folderId, name, description, method, url, queryParams, headers, bodyType, bodyContent, formFields,
             authType, authConfig, settings, postResponse, sortOrder, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(), collectionId, folderId, record.name, record.description, record.method, record.url,
          JSON.stringify(record.queryParams), JSON.stringify(record.headers), record.bodyType, record.bodyContent, JSON.stringify(record.formFields),
          record.authType, JSON.stringify(record.authConfig), JSON.stringify(record.settings), JSON.stringify(record.postResponse),
          folderId ? request.sortOrder || 0 : rootOrder++, req.user.id, now, now
        );
        requestCount += 1;
      }
      let firstEnvironmentId = null;
      for (const environment of item.environments) {
        const id = crypto.randomUUID();
        firstEnvironmentId ||= id;
        await db.run(
          "INSERT INTO api_environments (id, collectionId, name, variables, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id, collectionId, environment.name, JSON.stringify(prepareVariablesForStorage(environment.variables, [])),
          await nextSortOrder(db, "api_environments", "collectionId = ?", collectionId), now, now
        );
      }
      if (firstEnvironmentId) {
        await db.run("UPDATE api_collections SET activeEnvironmentId = COALESCE(activeEnvironmentId, ?) WHERE id = ?", firstEnvironmentId, collectionId);
      }
      await db.run("UPDATE api_collections SET updatedAt = ? WHERE id = ?", now, collectionId);
      created.push({ id: collectionId, name: targetCollectionId ? "(colecao existente)" : item.name });
    }
  });

  res.status(201).json({ format: parsed.format, collections: created, requestCount });
});

router.use((error, _req, _res, next) => {
  if (error instanceof HttpError) return next(error);
  if (error?.message?.includes("SQLITE_CONSTRAINT")) return next(new HttpError(409, "Violacao de integridade nos dados da colecao."));
  return next(error);
});

export default router;
