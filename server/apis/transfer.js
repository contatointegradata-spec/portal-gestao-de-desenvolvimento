import { HTTP_METHODS } from "./executor.js";

// ─── cURL ─────────────────────────────────────────────────────────────────────
function tokenizeShell(input) {
  const text = String(input || "")
    .replace(/\\\r?\n/g, " ")   // continuacao bash
    .replace(/\^\r?\n/g, " ")   // continuacao cmd.exe
    .replace(/`\r?\n/g, " ")    // continuacao PowerShell
    .trim();
  const tokens = [];
  let current = "";
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && i + 1 < text.length && ['"', "\\", "$", "`"].includes(text[i + 1])) {
        current += text[++i];
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === "$" && text[i + 1] === "'") {
      quote = "'";
      hasToken = true;
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken || current) tokens.push(current);
      current = "";
      hasToken = false;
      continue;
    }
    if (char === "\\" && i + 1 < text.length) {
      current += text[++i];
      hasToken = true;
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken || current) tokens.push(current);
  return tokens;
}

export function parseCurl(command) {
  const tokens = tokenizeShell(command);
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) throw new Error("O comando deve comecar com \"curl\".");
  const draft = {
    name: "Requisicao importada",
    method: "",
    url: "",
    queryParams: [],
    headers: [],
    bodyType: "none",
    bodyContent: "",
    formFields: [],
    authType: "none",
    authConfig: {},
    settings: { timeoutMs: 30000, followRedirects: false, insecureTls: false }
  };
  const dataParts = [];
  let forceGet = false;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const [flag, inlineValue] = token.startsWith("--") && token.includes("=") ? [token.slice(0, token.indexOf("=")), token.slice(token.indexOf("=") + 1)] : [token, undefined];
    const value = () => (inlineValue !== undefined ? inlineValue : tokens[++i] ?? "");
    switch (flag) {
      case "-X": case "--request": draft.method = value().toUpperCase(); break;
      case "-H": case "--header": {
        const header = value();
        const separator = header.indexOf(":");
        if (separator > 0) draft.headers.push({ key: header.slice(0, separator).trim(), value: header.slice(separator + 1).trim(), enabled: true });
        break;
      }
      case "-d": case "--data": case "--data-raw": case "--data-binary": case "--data-ascii": dataParts.push(value()); break;
      case "--data-urlencode": dataParts.push(value()); break;
      case "-F": case "--form": {
        const field = value();
        const separator = field.indexOf("=");
        if (separator > 0) draft.formFields.push({ key: field.slice(0, separator), value: field.slice(separator + 1), enabled: true });
        draft.bodyType = "multipart";
        break;
      }
      case "-u": case "--user": {
        const credentials = value();
        const separator = credentials.indexOf(":");
        draft.authType = "basic";
        draft.authConfig = { username: separator >= 0 ? credentials.slice(0, separator) : credentials, password: separator >= 0 ? credentials.slice(separator + 1) : "" };
        break;
      }
      case "--url": draft.url = value(); break;
      case "-G": case "--get": forceGet = true; break;
      case "-k": case "--insecure": draft.settings.insecureTls = true; break;
      case "-L": case "--location": draft.settings.followRedirects = true; break;
      case "-A": case "--user-agent": draft.headers.push({ key: "User-Agent", value: value(), enabled: true }); break;
      case "-b": case "--cookie": draft.headers.push({ key: "Cookie", value: value(), enabled: true }); break;
      case "--compressed": case "-s": case "--silent": case "-v": case "--verbose": case "-i": case "--include": break;
      case "-o": case "--output": case "-m": case "--max-time": case "--connect-timeout": value(); break;
      default:
        if (!token.startsWith("-") && !draft.url) draft.url = token;
    }
  }

  if (dataParts.length) {
    const data = dataParts.join("&");
    if (forceGet) {
      const url = new URL(/^https?:\/\//i.test(draft.url) ? draft.url : `http://${draft.url}`);
      for (const [key, value] of new URLSearchParams(data)) url.searchParams.append(key, value);
      draft.url = url.toString();
    } else {
      const contentType = draft.headers.find((header) => header.key.toLowerCase() === "content-type")?.value || "";
      const trimmed = data.trim();
      if (/json/i.test(contentType) || ((trimmed.startsWith("{") || trimmed.startsWith("[")) && !/x-www-form-urlencoded/i.test(contentType))) {
        draft.bodyType = "json";
        try { draft.bodyContent = JSON.stringify(JSON.parse(trimmed), null, 2); } catch { draft.bodyContent = data; }
      } else if (/xml/i.test(contentType)) {
        draft.bodyType = "xml";
        draft.bodyContent = data;
      } else if (!contentType || /x-www-form-urlencoded/i.test(contentType)) {
        draft.bodyType = "form_urlencoded";
        draft.formFields = [...new URLSearchParams(data)].map(([key, value]) => ({ key, value, enabled: true }));
      } else {
        draft.bodyType = "text";
        draft.bodyContent = data;
      }
    }
  }

  // Authorization: Bearer vira autenticacao estruturada
  const authHeaderIndex = draft.headers.findIndex((header) => header.key.toLowerCase() === "authorization" && /^bearer\s+/i.test(header.value));
  if (authHeaderIndex >= 0 && draft.authType === "none") {
    draft.authType = "bearer";
    draft.authConfig = { token: draft.headers[authHeaderIndex].value.replace(/^bearer\s+/i, ""), prefix: "Bearer" };
    draft.headers.splice(authHeaderIndex, 1);
  }

  if (!draft.url) throw new Error("URL nao encontrada no comando cURL.");
  draft.method = HTTP_METHODS.includes(draft.method) ? draft.method : (dataParts.length || draft.formFields.length) && !forceGet ? "POST" : "GET";
  try {
    const parsed = new URL(/^https?:\/\//i.test(draft.url) ? draft.url : `http://${draft.url}`);
    draft.name = `${draft.method} ${parsed.pathname === "/" ? parsed.host : parsed.pathname.split("/").filter(Boolean).slice(-2).join("/")}`;
  } catch { /* nome padrao */ }
  return draft;
}

// ─── Postman v2.x ─────────────────────────────────────────────────────────────
function postmanKv(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({ key: String(item.key ?? ""), value: String(item.value ?? ""), enabled: !item.disabled })).filter((item) => item.key);
}

function postmanAuth(auth) {
  if (!auth || !auth.type) return { authType: "inherit", authConfig: {} };
  const read = (key) => {
    const list = auth[auth.type];
    if (Array.isArray(list)) return String(list.find((item) => item.key === key)?.value ?? "");
    return String(list?.[key] ?? "");
  };
  switch (auth.type) {
    case "noauth": return { authType: "none", authConfig: {} };
    case "bearer": return { authType: "bearer", authConfig: { token: read("token"), prefix: "Bearer" } };
    case "basic": return { authType: "basic", authConfig: { username: read("username"), password: read("password") } };
    case "apikey": return { authType: "api_key", authConfig: { key: read("key"), value: read("value"), in: read("in") === "query" ? "query" : "header" } };
    case "oauth2": return {
      authType: "oauth2",
      authConfig: {
        grantType: read("grant_type") === "password_credentials" ? "password" : "client_credentials",
        tokenUrl: read("accessTokenUrl"),
        clientId: read("clientId"),
        clientSecret: read("clientSecret"),
        scope: read("scope"),
        username: read("username"),
        password: read("password"),
        credentialsLocation: read("client_authentication") === "body" ? "body" : "basic_auth_header"
      }
    };
    default: return { authType: "none", authConfig: {} };
  }
}

function postmanRequest(item) {
  const request = typeof item.request === "string" ? { url: item.request, method: "GET" } : item.request || {};
  const url = typeof request.url === "string" ? request.url : request.url?.raw || "";
  const [baseUrl] = url.split("?");
  const queryParams = typeof request.url === "object" && Array.isArray(request.url.query)
    ? postmanKv(request.url.query)
    : [...new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "")].map(([key, value]) => ({ key, value, enabled: true }));
  const body = request.body || {};
  let bodyType = "none";
  let bodyContent = "";
  let formFields = [];
  if (body.mode === "raw") {
    const language = body.options?.raw?.language || "";
    bodyType = language === "json" || /^\s*[{[]/.test(body.raw || "") ? "json" : language === "xml" ? "xml" : "text";
    bodyContent = body.raw || "";
  } else if (body.mode === "urlencoded") {
    bodyType = "form_urlencoded";
    formFields = postmanKv(body.urlencoded);
  } else if (body.mode === "formdata") {
    bodyType = "multipart";
    formFields = postmanKv((body.formdata || []).filter((field) => field.type !== "file"));
  } else if (body.mode === "graphql") {
    bodyType = "json";
    bodyContent = JSON.stringify({ query: body.graphql?.query || "", variables: body.graphql?.variables ? JSON.parse(body.graphql.variables || "{}") : {} }, null, 2);
  }
  return {
    name: item.name || "Requisicao",
    description: typeof request.description === "string" ? request.description : request.description?.content || "",
    method: String(request.method || "GET").toUpperCase(),
    url: baseUrl,
    queryParams,
    headers: postmanKv(request.header),
    bodyType,
    bodyContent,
    formFields,
    ...postmanAuth(request.auth),
    settings: { timeoutMs: 30000, followRedirects: true, insecureTls: false },
    postResponse: []
  };
}

function importPostman(json) {
  const folders = [];
  const requests = [];
  const walk = (items, parentRef) => {
    (items || []).forEach((item, index) => {
      if (Array.isArray(item.item)) {
        const ref = `f${folders.length}`;
        folders.push({ ref, parentRef, name: item.name || "Pasta", description: typeof item.description === "string" ? item.description : "", sortOrder: index, ...postmanAuth(item.auth) });
        walk(item.item, ref);
      } else {
        requests.push({ ...postmanRequest(item), folderRef: parentRef, sortOrder: index });
      }
    });
  };
  walk(json.item, null);
  const collectionAuth = postmanAuth(json.auth);
  const variables = postmanKv(json.variable).map((item) => ({ ...item, secret: /token|secret|senha|password|key/i.test(item.key) }));
  return [{
    name: json.info?.name || "Colecao importada",
    description: typeof json.info?.description === "string" ? json.info.description : "",
    authType: collectionAuth.authType === "inherit" ? "none" : collectionAuth.authType,
    authConfig: collectionAuth.authConfig,
    folders,
    requests,
    environments: variables.length ? [{ name: "Variaveis da colecao", variables }] : []
  }];
}

// ─── Insomnia v4 ──────────────────────────────────────────────────────────────
function insomniaVars(text) {
  return String(text ?? "").replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, "{{$1}}");
}

function insomniaAuth(auth) {
  if (!auth || !auth.type) return { authType: "inherit", authConfig: {} };
  switch (auth.type) {
    case "bearer": return { authType: "bearer", authConfig: { token: insomniaVars(auth.token), prefix: auth.prefix || "Bearer" } };
    case "basic": return { authType: "basic", authConfig: { username: insomniaVars(auth.username), password: insomniaVars(auth.password) } };
    case "apikey": return { authType: "api_key", authConfig: { key: insomniaVars(auth.key), value: insomniaVars(auth.value), in: auth.addTo === "queryParams" ? "query" : "header" } };
    case "oauth2": return {
      authType: "oauth2",
      authConfig: {
        grantType: auth.grantType === "password" ? "password" : "client_credentials",
        tokenUrl: insomniaVars(auth.accessTokenUrl),
        clientId: insomniaVars(auth.clientId),
        clientSecret: insomniaVars(auth.clientSecret),
        scope: insomniaVars(auth.scope),
        username: insomniaVars(auth.username),
        password: insomniaVars(auth.password),
        credentialsLocation: auth.credentialsType === "body" ? "body" : "basic_auth_header"
      }
    };
    case "none": return { authType: "none", authConfig: {} };
    default: return { authType: "none", authConfig: {} };
  }
}

function importInsomnia(json) {
  const resources = Array.isArray(json.resources) ? json.resources : [];
  const workspaces = resources.filter((item) => item._type === "workspace");
  if (!workspaces.length) workspaces.push({ _id: "__root__", name: "Colecao importada" });
  const byParent = new Map();
  for (const item of resources) {
    const list = byParent.get(item.parentId) || [];
    list.push(item);
    byParent.set(item.parentId, list);
  }

  return workspaces.map((workspace) => {
    const folders = [];
    const requests = [];
    const environments = [];
    const walk = (parentId, parentRef) => {
      const children = (byParent.get(parentId) || []).sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0));
      children.forEach((item, index) => {
        if (item._type === "request_group") {
          const ref = item._id;
          folders.push({ ref, parentRef, name: item.name || "Pasta", description: item.description || "", sortOrder: index, ...insomniaAuth(item.authentication) });
          walk(item._id, ref);
        } else if (item._type === "request") {
          const mimeType = item.body?.mimeType || "";
          let bodyType = "none";
          let bodyContent = "";
          let formFields = [];
          if (mimeType.includes("json")) { bodyType = "json"; bodyContent = insomniaVars(item.body?.text); }
          else if (mimeType.includes("xml")) { bodyType = "xml"; bodyContent = insomniaVars(item.body?.text); }
          else if (mimeType.includes("x-www-form-urlencoded")) {
            bodyType = "form_urlencoded";
            formFields = (item.body?.params || []).map((param) => ({ key: param.name, value: insomniaVars(param.value), enabled: !param.disabled }));
          } else if (mimeType.includes("multipart")) {
            bodyType = "multipart";
            formFields = (item.body?.params || []).filter((param) => param.type !== "file").map((param) => ({ key: param.name, value: insomniaVars(param.value), enabled: !param.disabled }));
          } else if (item.body?.text) { bodyType = "text"; bodyContent = insomniaVars(item.body.text); }
          requests.push({
            name: item.name || "Requisicao",
            description: item.description || "",
            method: String(item.method || "GET").toUpperCase(),
            url: insomniaVars(item.url),
            queryParams: (item.parameters || []).map((param) => ({ key: param.name, value: insomniaVars(param.value), enabled: !param.disabled })).filter((param) => param.key),
            headers: (item.headers || []).map((header) => ({ key: header.name, value: insomniaVars(header.value), enabled: !header.disabled })).filter((header) => header.key),
            bodyType,
            bodyContent,
            formFields,
            ...insomniaAuth(item.authentication),
            settings: { timeoutMs: 30000, followRedirects: item.settingFollowRedirects !== "off", insecureTls: false },
            postResponse: [],
            folderRef: parentRef,
            sortOrder: index
          });
        } else if (item._type === "environment") {
          const data = item.data && typeof item.data === "object" ? item.data : {};
          const variables = Object.entries(data)
            .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
            .map(([key, value]) => ({ key, value: String(value), enabled: true, secret: /token|secret|senha|password|key/i.test(key) }));
          if (variables.length) environments.push({ name: item.name || "Ambiente", variables });
          walk(item._id, parentRef);
        }
      });
    };
    walk(workspace._id, null);
    return { name: workspace.name || "Colecao importada", description: workspace.description || "", authType: "none", authConfig: {}, folders, requests, environments };
  });
}

const SENSITIVE_AUTH_FIELDS = ["token", "password", "clientSecret", "value"];
const SENSITIVE_NAME_RE = /token|secret|senha|password|passwd|key|credential/i;

/** Variaveis usadas em campos sensiveis de autenticacao sao importadas como segredo. */
function markSecretVariables(collection) {
  const referenced = new Set();
  const scan = (config) => {
    for (const field of SENSITIVE_AUTH_FIELDS) {
      for (const match of String(config?.[field] ?? "").matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) referenced.add(match[1]);
    }
  };
  scan(collection.authConfig);
  collection.folders.forEach((folder) => scan(folder.authConfig));
  collection.requests.forEach((request) => scan(request.authConfig));
  for (const environment of collection.environments) {
    environment.variables = environment.variables.map((variable) => ({
      ...variable,
      secret: Boolean(variable.secret) || referenced.has(variable.key) || SENSITIVE_NAME_RE.test(variable.key)
    }));
  }
  return collection;
}

/** Detecta o formato e devolve colecoes normalizadas prontas para gravacao. */
export function parseImport(content) {
  const result = parseImportRaw(content);
  return { ...result, collections: result.collections.map(markSecretVariables) };
}

function parseImportRaw(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("Cole o conteudo a importar ou selecione um arquivo.");
  if (/^curl(\.exe)?\s/i.test(text)) {
    const draft = parseCurl(text);
    return { format: "curl", collections: [{ name: "Importado via cURL", description: "", authType: "none", authConfig: {}, folders: [], requests: [{ ...draft, folderRef: null, sortOrder: 0 }], environments: [] }] };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Formato nao reconhecido. Use JSON do Postman (v2.1), Insomnia (v4) ou um comando cURL.");
  }
  if (json?.info && Array.isArray(json.item)) return { format: "postman", collections: importPostman(json) };
  if (json?._type === "export" && Array.isArray(json.resources)) return { format: "insomnia", collections: importInsomnia(json) };
  if (json?.collection?.info && Array.isArray(json.collection.item)) return { format: "postman", collections: importPostman(json.collection) };
  throw new Error("JSON nao reconhecido. Exporte do Postman como \"Collection v2.1\" ou do Insomnia como \"Insomnia v4 (JSON)\".");
}

// ─── Exportacao (Postman v2.1, sem segredos) ──────────────────────────────────
function exportAuth(type, config) {
  const kv = (entries) => entries.map(([key, value]) => ({ key, value: value ?? "", type: "string" }));
  switch (type) {
    case "inherit": return undefined;
    case "none": return { type: "noauth" };
    case "bearer": return { type: "bearer", bearer: kv([["token", ""]]) };
    case "basic": return { type: "basic", basic: kv([["username", config.username], ["password", ""]]) };
    case "api_key": return { type: "apikey", apikey: kv([["key", config.key], ["value", ""], ["in", config.in]]) };
    case "oauth2": return {
      type: "oauth2",
      oauth2: kv([
        ["grant_type", config.grantType === "password" ? "password_credentials" : "client_credentials"],
        ["accessTokenUrl", config.tokenUrl], ["clientId", config.clientId], ["clientSecret", ""], ["scope", config.scope],
        ["client_authentication", config.credentialsLocation === "body" ? "body" : "header"]
      ])
    };
    default: return undefined;
  }
}

export function exportPostman({ collection, folders, requests, environments }) {
  const requestItem = (request) => {
    const body = (() => {
      if (request.bodyType === "json") return { mode: "raw", raw: request.bodyContent || "", options: { raw: { language: "json" } } };
      if (request.bodyType === "xml") return { mode: "raw", raw: request.bodyContent || "", options: { raw: { language: "xml" } } };
      if (request.bodyType === "text") return { mode: "raw", raw: request.bodyContent || "" };
      if (request.bodyType === "form_urlencoded") return { mode: "urlencoded", urlencoded: request.formFields.map((field) => ({ key: field.key, value: field.value, disabled: !field.enabled })) };
      if (request.bodyType === "multipart") return { mode: "formdata", formdata: request.formFields.map((field) => ({ key: field.key, value: field.value, type: "text", disabled: !field.enabled })) };
      return undefined;
    })();
    return {
      name: request.name,
      request: {
        method: request.method,
        header: request.headers.map((header) => ({ key: header.key, value: header.value, disabled: !header.enabled })),
        url: {
          raw: request.url,
          query: request.queryParams.map((param) => ({ key: param.key, value: param.value, disabled: !param.enabled }))
        },
        ...(body ? { body } : {}),
        ...(exportAuth(request.authType, request.authConfig) ? { auth: exportAuth(request.authType, request.authConfig) } : {}),
        description: request.description || ""
      }
    };
  };
  const buildLevel = (parentId) => [
    ...folders.filter((folder) => (folder.parentId || null) === parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((folder) => ({
      name: folder.name,
      description: folder.description || "",
      item: buildLevel(folder.id),
      ...(exportAuth(folder.authType, folder.authConfig) ? { auth: exportAuth(folder.authType, folder.authConfig) } : {})
    })),
    ...requests.filter((request) => (request.folderId || null) === parentId).sort((a, b) => a.sortOrder - b.sortOrder).map(requestItem)
  ];
  const firstEnvironment = environments[0];
  return {
    info: {
      name: collection.name,
      description: `${collection.description || ""}\n\nExportado da plataforma Gestao de Desenvolvimento - Integradata. Segredos (senhas, tokens e client secrets) nao sao exportados.`.trim(),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: buildLevel(null),
    ...(exportAuth(collection.authType, collection.authConfig) ? { auth: exportAuth(collection.authType, collection.authConfig) } : {}),
    variable: (firstEnvironment?.variables || []).map((variable) => ({ key: variable.key, value: variable.secret ? "" : variable.value }))
  };
}
