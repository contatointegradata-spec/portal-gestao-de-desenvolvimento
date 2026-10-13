/**
 * Teste de fumaca da plataforma (backend).
 * Sobe o servidor com um banco temporario + um servidor HTTP de eco local e
 * valida os fluxos principais: autenticacao, usuarios, sistemas, RPA e API/Plugins.
 *
 * Uso: npm run test:smoke
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gestao-smoke-"));
const PORT = 5191;
const ECHO_PORT = 5192;
const BASE = `http://127.0.0.1:${PORT}`;
const ECHO = `http://127.0.0.1:${ECHO_PORT}`;
const MASTER = { email: "master.smoke@example.com", password: "Master123!" };
let passed = 0;

// ─── Servidor de eco (alvo das requisicoes do modulo API) ────────────────────
let tokenRequests = 0;
const echo = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const url = new URL(req.url, ECHO);
    const body = Buffer.concat(chunks).toString("utf8");
    if (url.pathname === "/oauth/token") {
      tokenRequests += 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ access_token: `tok-${tokenRequests}`, expires_in: 3600, token_type: "Bearer", received: body, auth: req.headers.authorization || "" }));
    }
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "/echo?redirected=1" });
      return res.end();
    }
    if (url.pathname === "/gzip") {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      return res.end(zlib.gzipSync(JSON.stringify({ compressed: true })));
    }
    if (url.pathname === "/login") {
      res.writeHead(200, { "content-type": "application/json", "x-session": "abc123" });
      return res.end(JSON.stringify({ data: { token: "extracted-token-xyz", items: [{ id: 7 }] } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body }));
  });
});
await new Promise((resolve) => echo.listen(ECHO_PORT, "127.0.0.1", resolve));

// ─── Servidor da plataforma ───────────────────────────────────────────────────
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: path.join(tempDir, "smoke.sqlite"),
    MASTER_EMAIL: MASTER.email,
    MASTER_PASSWORD: MASTER.password,
    APP_SECRET_KEY: "smoke-secret-key",
    RPA_HEADLESS: "1",
    MAIL_USER: "",
    MAIL_APP_PASSWORD: "",
    NODE_ENV: "test"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLogs = "";
server.stdout.on("data", (chunk) => { serverLogs += chunk; });
server.stderr.on("data", (chunk) => { serverLogs += chunk; });

async function request(pathname, { method = "GET", token, body, headers = {}, raw } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

async function expectStatus(label, promise, status) {
  const result = await promise;
  assert.equal(result.status, status, `${label}: esperado HTTP ${status}, recebido ${result.status} ${JSON.stringify(result.data)}`);
  passed += 1;
  return result.data;
}

async function waitFor(fn, { timeoutMs = 60000, intervalMs = 300, label = "condicao" } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout aguardando ${label}`);
}

async function waitRun(token, runId, timeoutMs = 90000) {
  return waitFor(async () => {
    const { data } = await request(`/api/runs/${runId}`, { token });
    return data && data.status !== "running" ? data : null;
  }, { timeoutMs, label: `execucao ${runId}` });
}

async function readSse(token, runId) {
  const response = await fetch(`${BASE}/api/runs/${runId}/stream`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  return text.split("\n\n").filter(Boolean).map((block) => {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    return event ? { event, data: data ? JSON.parse(data) : null } : null;
  }).filter(Boolean);
}

try {
  await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, { timeoutMs: 20000, label: "servidor" });

  // ─── Autenticacao ───────────────────────────────────────────────────────────
  await expectStatus("login invalido", request("/api/auth/login", { method: "POST", body: { email: MASTER.email, password: "errada" } }), 401);
  const masterLogin = await expectStatus("login master", request("/api/auth/login", { method: "POST", body: MASTER }), 200);
  const master = masterLogin.token;
  assert.equal(masterLogin.user.isMaster, true);
  await expectStatus("rota de chamados removida", request("/api/tickets", { token: master }), 404);
  await expectStatus("registro publico bloqueado", request("/api/auth/register", { method: "POST", body: {} }), 403);
  for (let i = 0; i < 8; i += 1) await request("/api/auth/login", { method: "POST", body: { email: "bruteforce@example.com", password: "x" } });
  await expectStatus("rate limit de login", request("/api/auth/login", { method: "POST", body: { email: "bruteforce@example.com", password: "x" } }), 429);
  await expectStatus("codigo de reset invalido", request("/api/auth/verify-reset-code", { method: "POST", body: { email: MASTER.email, code: "000000" } }), 400);

  // ─── Usuarios ───────────────────────────────────────────────────────────────
  await expectStatus("senha fraca", request("/api/users", { method: "POST", token: master, body: { nome: "Fraca", email: "fraca@example.com", senha: "123", role: "user" } }), 400);
  const admin = (await expectStatus("cria admin", request("/api/users", { method: "POST", token: master, body: { nome: "Admin Smoke", email: "admin@example.com", senha: "Admin1234", role: "admin", departamento: "Tecnologia" } }), 201)).user;
  const common = (await expectStatus("cria usuario", request("/api/users", { method: "POST", token: master, body: { nome: "Usuario Smoke", email: "user@example.com", senha: "User12345", role: "user", departamento: "Relacionamento" } }), 201)).user;
  await expectStatus("email duplicado", request("/api/users", { method: "POST", token: master, body: { nome: "Dup", email: "user@example.com", senha: "User12345", role: "user" } }), 409);
  const adminToken = (await expectStatus("login admin", request("/api/auth/login", { method: "POST", body: { email: "admin@example.com", password: "Admin1234" } }), 200)).token;
  const userToken = (await expectStatus("login usuario", request("/api/auth/login", { method: "POST", body: { email: "user@example.com", password: "User12345" } }), 200)).token;
  const masterId = masterLogin.user.id;
  await expectStatus("admin nao cria usuario", request("/api/users", { method: "POST", token: adminToken, body: { nome: "X", email: "x@example.com", senha: "Abcdef123", role: "user" } }), 403);
  await expectStatus("admin nao edita master", request(`/api/users/${masterId}`, { method: "PATCH", token: adminToken, body: { email: "novo@example.com" } }), 403);
  await expectStatus("master nao pode ser desativado", request(`/api/users/${masterId}`, { method: "PATCH", token: master, body: { active: false } }), 403);
  await expectStatus("master nao pode ser removido", request(`/api/users/${masterId}`, { method: "DELETE", token: master }), 403);
  await expectStatus("usuario nao lista usuarios", request("/api/users", { token: userToken }), 403);
  await expectStatus("admin edita email de usuario", request(`/api/users/${common.id}`, { method: "PATCH", token: adminToken, body: { email: "user@example.com" } }), 400);
  const temp = (await expectStatus("cria usuario temporario", request("/api/users", { method: "POST", token: master, body: { nome: "Temp", email: "temp@example.com", senha: "Temp12345", role: "user" } }), 201)).user;
  const tempToken = (await request("/api/auth/login", { method: "POST", body: { email: "temp@example.com", password: "Temp12345" } })).data.token;
  await expectStatus("desativa usuario", request(`/api/users/${temp.id}`, { method: "PATCH", token: master, body: { active: false } }), 200);
  await expectStatus("sessao de inativo revogada", request("/api/auth/me", { token: tempToken }), 401);
  await expectStatus("login de inativo bloqueado", request("/api/auth/login", { method: "POST", body: { email: "temp@example.com", password: "Temp12345" } }), 403);
  await expectStatus("troca de senha propria", request("/api/users/me/password", { method: "PUT", token: userToken, body: { senhaAtual: "User12345", novaSenha: "User67890" } }), 204);
  await expectStatus("sessao atual mantida apos troca", request("/api/auth/me", { token: userToken }), 200);

  // ─── Sistemas ───────────────────────────────────────────────────────────────
  await expectStatus("sistema comum sem URL", request("/api/projects", { method: "POST", token: master, body: { nome: "Sem URL", descricao: "x", tecnologias: ["Vue"], responsibleUserId: common.id } }), 400);
  const commonProject = await expectStatus("cria sistema comum", request("/api/projects", { method: "POST", token: master, body: { nome: "Portal", descricao: "Portal interno", url: "portal.local", tecnologias: "Vue, Node", responsibleUserId: common.id, department: "Relacionamento" } }), 201);
  await expectStatus("admin edita sistema", request(`/api/projects/${commonProject.id}`, { method: "PATCH", token: adminToken, body: { status: "manutencao" } }), 200);
  await expectStatus("usuario nao cria sistema", request("/api/projects", { method: "POST", token: userToken, body: { nome: "X" } }), 403);
  await expectStatus("agendamento diario sem horario", request("/api/projects", { method: "POST", token: master, body: { nome: "RPA", descricao: "x", systemType: "rpa", language: "python", code: "print(1)", responsibleUserId: common.id, schedule: { mode: "daily", times: [] } } }), 400);

  const validation = await expectStatus("valida python com erro", request("/api/projects/validate-code", { method: "POST", token: master, body: { language: "python", code: "print('ok')\nif True\n  x = 1" } }), 200);
  assert.equal(validation.ok, false);
  assert.equal(validation.line, 2);
  const missing = await expectStatus("valida python modulo ausente", request("/api/projects/validate-code", { method: "POST", token: master, body: { language: "python", code: "import modulo_inexistente_xyz\nprint(1)" } }), 200);
  assert.equal(missing.ok, true);
  assert.match(missing.warnings[0], /modulo_inexistente_xyz/);
  const jsValidation = await expectStatus("valida js", request("/api/projects/validate-code", { method: "POST", token: master, body: { language: "javascript", code: "const a = ;" } }), 200);
  assert.equal(jsValidation.ok, false);

  const pythonCode = [
    "import os, sys, json",
    "entrada = sys.argv[1]",
    "print(f'Arquivo recebido: {os.path.basename(entrada)}')",
    "linhas = open(entrada, encoding='utf-8').read().splitlines()",
    "for i, linha in enumerate(linhas, start=1):",
    "    rpa.progress(i, len(linhas), f'Processando {linha} 🚀')",
    "rpa.save_output('resultado.json', json.dumps({'total': len(linhas)}))",
    "print('Concluido com sucesso')"
  ].join("\n");
  const pyProject = await expectStatus("cria RPA python", request("/api/projects", { method: "POST", token: master, body: {
    nome: "RPA Python Smoke", descricao: "Teste", systemType: "rpa", language: "python", code: pythonCode, responsibleUserId: common.id,
    schedule: { mode: "daily", times: ["08:00", "8:30"], weekdays: [1, 2, 3, 4, 5] }, timeoutSeconds: 60
  } }), 201);
  assert.deepEqual(pyProject.schedule.times, ["08:00", "08:30"]);
  assert.ok(pyProject.nextRunAt, "proxima execucao calculada");
  const upload = await expectStatus("upload de arquivo", request(`/api/projects/${pyProject.id}/files`, {
    method: "POST", token: master, raw: Buffer.from("linha A\nlinha B\nlinha C", "utf8"), headers: { "Content-Type": "text/plain", "X-File-Name": encodeURIComponent("entrada ção.txt") }
  }), 201);
  assert.equal(upload.files.length, 1);
  const replaced = await expectStatus("substitui arquivo", request(`/api/projects/${pyProject.id}/files`, {
    method: "POST", token: master, raw: Buffer.from("linha A\nlinha B\nlinha C", "utf8"), headers: { "Content-Type": "text/plain", "X-File-Name": encodeURIComponent("entrada ção.txt") }
  }), 200);
  assert.equal(replaced.replaced, true);
  const download = await fetch(`${BASE}/api/projects/${pyProject.id}/files/${upload.files[0].id}/download`, { headers: { Authorization: `Bearer ${userToken}` } });
  assert.equal(await download.text(), "linha A\nlinha B\nlinha C");
  passed += 1;

  const userProjects = await expectStatus("usuario lista os proprios sistemas", request("/api/projects", { token: userToken }), 200);
  assert.equal(userProjects.length, 2);
  assert.equal(userProjects.find((item) => item.id === pyProject.id).permissions.canRun, true);

  const pyRun = await expectStatus("usuario responsavel executa RPA", request(`/api/projects/${pyProject.id}/runs`, { method: "POST", token: userToken }), 202);
  await expectStatus("execucao concorrente bloqueada", request(`/api/projects/${pyProject.id}/runs`, { method: "POST", token: master }), 409);
  const events = await readSse(userToken, pyRun.runId);
  assert.equal(events[0].event, "snapshot");
  const done = events.find((item) => item.event === "done");
  assert.ok(done, `evento done ausente: ${JSON.stringify(events).slice(0, 500)}`);
  assert.equal(done.data.status, "success", JSON.stringify(done.data.events?.slice(-5)));
  const allLogs = [...(events[0].data.events || []), ...events.filter((item) => item.event === "log").map((item) => item.data)];
  assert.ok(allLogs.some((item) => item.level === "progress" && item.total === 3), "progresso emitido");
  assert.ok(allLogs.some((item) => String(item.message).includes("🚀")), "emoji/UTF-8 preservado");
  assert.equal(done.data.artifacts.length, 1);
  const artifact = await fetch(`${BASE}/api/runs/${pyRun.runId}/artifacts/${done.data.artifacts[0].id}/download`, { headers: { Authorization: `Bearer ${master}` } });
  assert.deepEqual(await artifact.json(), { total: 3 });
  passed += 3;

  const jsCode = [
    "const fs = require('fs');",
    "const XLSX = require('xlsx');",
    "const linhas = fs.readFileSync(rpa.inputFile, 'utf8').split('\\n');",
    "console.log('Linhas lidas: ' + linhas.length);",
    "rpa.saveOutput('saida.txt', 'ok ' + typeof XLSX.utils.sheet_to_json);",
    "async function main() { await new Promise(r => setTimeout(r, 200)); rpa.success('Finalizado'); }",
    "main();"
  ].join("\n");
  const jsProject = await expectStatus("cria RPA javascript", request("/api/projects", { method: "POST", token: master, body: {
    nome: "RPA JS Smoke", descricao: "Teste", systemType: "rpa", language: "javascript", code: jsCode, responsibleUserId: admin.id
  } }), 201);
  await request(`/api/projects/${jsProject.id}/files`, { method: "POST", token: master, raw: Buffer.from("a\nb"), headers: { "X-File-Name": "dados.txt" } });
  await expectStatus("usuario nao executa RPA de outro", request(`/api/projects/${jsProject.id}/runs`, { method: "POST", token: userToken }), 404);
  const jsRun = await expectStatus("executa RPA javascript", request(`/api/projects/${jsProject.id}/runs`, { method: "POST", token: adminToken }), 202);
  const jsDetail = await waitRun(adminToken, jsRun.runId);
  assert.equal(jsDetail.status, "success", JSON.stringify(jsDetail.events?.slice(-5)));
  assert.ok(jsDetail.events.some((item) => item.message === "Linhas lidas: 2"));
  assert.equal(jsDetail.artifacts[0].fileName, "saida.txt");
  passed += 1;

  const errorProject = await expectStatus("cria RPA com erro de execucao", request("/api/projects", { method: "POST", token: master, body: {
    nome: "RPA Erro", descricao: "x", systemType: "rpa", language: "python", code: "print('antes')\nraise ValueError('falha proposital')", responsibleUserId: admin.id
  } }), 201);
  const errorRun = await request(`/api/projects/${errorProject.id}/runs`, { method: "POST", token: master });
  const errorDetail = await waitRun(master, errorRun.data.runId);
  assert.equal(errorDetail.status, "error");
  assert.match(errorDetail.errorMessage, /falha proposital/);
  assert.match(errorDetail.errorMessage, /line 2/);
  passed += 1;

  const slowProject = await expectStatus("cria RPA lento", request("/api/projects", { method: "POST", token: master, body: {
    nome: "RPA Lento", descricao: "x", systemType: "rpa", language: "python", code: "import time\nprint('inicio')\ntime.sleep(60)", responsibleUserId: admin.id, timeoutSeconds: 10
  } }), 201);
  const slowRun = await request(`/api/projects/${slowProject.id}/runs`, { method: "POST", token: master });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await expectStatus("cancela execucao", request(`/api/runs/${slowRun.data.runId}/cancel`, { method: "POST", token: master }), 202);
  assert.equal((await waitRun(master, slowRun.data.runId, 20000)).status, "cancelled");
  const timeoutRun = await request(`/api/projects/${slowProject.id}/runs`, { method: "POST", token: master });
  assert.equal((await waitRun(master, timeoutRun.data.runId, 30000)).status, "timeout");
  passed += 2;

  const runs = await expectStatus("historico de execucoes", request(`/api/projects/${pyProject.id}/runs`, { token: userToken }), 200);
  assert.equal(runs[0].status, "success");
  const notifications = await expectStatus("notificacoes do responsavel", request("/api/notifications", { token: userToken }), 200);
  assert.ok(notifications.items.some((item) => item.kind === "rpa_success"));
  const duplicated = await expectStatus("duplica sistema", request(`/api/projects/${pyProject.id}/duplicate`, { method: "POST", token: master }), 201);
  assert.equal(duplicated.fileCount, 1);
  assert.equal(duplicated.schedule.mode, "manual");
  await expectStatus("exclui sistema", request(`/api/projects/${duplicated.id}`, { method: "DELETE", token: master }), 204);

  // ─── API / Plugins ──────────────────────────────────────────────────────────
  const collection = await expectStatus("cria colecao", request("/api/apis/collections", { method: "POST", token: master, body: { name: "Echo", scope: "internal" } }), 201);
  await expectStatus("usuario nao cria colecao", request("/api/apis/collections", { method: "POST", token: userToken, body: { name: "X" } }), 403);
  const env = await expectStatus("cria ambiente", request("/api/apis/environments", { method: "POST", token: master, body: {
    collectionId: collection.id, name: "Local", variables: [{ key: "baseUrl", value: ECHO }, { key: "token", value: "segredo-123", secret: true }]
  } }), 201);
  assert.equal(env.variables[1].value, "__SECRET_UNCHANGED__");
  const folder = await expectStatus("cria pasta", request("/api/apis/folders", { method: "POST", token: master, body: { collectionId: collection.id, name: "Autenticadas" } }), 201);
  const subfolder = await expectStatus("cria subpasta", request("/api/apis/folders", { method: "POST", token: master, body: { collectionId: collection.id, parentId: folder.id, name: "Clientes" } }), 201);
  await expectStatus("auth na pasta", request(`/api/apis/folders/${folder.id}`, { method: "PATCH", token: master, body: { authType: "bearer", authConfig: { token: "{{token}}" } } }), 200);
  const echoRequest = await expectStatus("cria requisicao", request("/api/apis/requests", { method: "POST", token: master, body: {
    collectionId: collection.id, folderId: subfolder.id, name: "Echo POST", method: "POST", url: "{{baseUrl}}/echo",
    queryParams: [{ key: "q", value: "1", enabled: true }, { key: "off", value: "x", enabled: false }],
    headers: [{ key: "X-Custom", value: "{{$randomUUID}}", enabled: true }],
    bodyType: "json", bodyContent: "{\"nome\": \"{{baseUrl}}\"}", authType: "inherit"
  } }), 201);
  const sent = await expectStatus("envia requisicao (auth herdada)", request(`/api/apis/requests/${echoRequest.id}/send`, { method: "POST", token: userToken, body: { environmentId: env.id } }), 200);
  assert.equal(sent.ok, true);
  const echoed = JSON.parse(sent.body);
  assert.equal(echoed.headers.authorization, "Bearer segredo-123");
  assert.deepEqual(echoed.query, { q: "1" });
  assert.equal(JSON.parse(echoed.body).nome, ECHO);
  assert.equal(sent.request.headers.authorization, "••••••");
  assert.equal(sent.auth.source, 'Pasta "Autenticadas"');

  const draftSend = await expectStatus("envia rascunho com segredo mascarado", request(`/api/apis/requests/${echoRequest.id}/send`, { method: "POST", token: master, body: {
    environmentId: env.id, draft: { method: "GET", url: "{{baseUrl}}/redirect", authType: "basic", authConfig: { username: "joao", password: "Senha!1" }, bodyType: "none" }
  } }), 200);
  assert.equal(JSON.parse(draftSend.body).query.redirected, "1");
  assert.equal(draftSend.redirects.length, 1);
  assert.equal(JSON.parse(draftSend.body).headers.authorization, `Basic ${Buffer.from("joao:Senha!1").toString("base64")}`);

  const loginRequest = await expectStatus("cria requisicao com extracao", request("/api/apis/requests", { method: "POST", token: master, body: {
    collectionId: collection.id, name: "Login", method: "POST", url: "{{baseUrl}}/login", authType: "none",
    postResponse: [{ source: "body", path: "data.token", variable: "token", secret: true }, { source: "header", path: "x-session", variable: "sessao" }, { source: "body", path: "data.items[0].id", variable: "primeiroId" }]
  } }), 201);
  const loginSent = await expectStatus("extrai variaveis", request(`/api/apis/requests/${loginRequest.id}/send`, { method: "POST", token: master, body: { environmentId: env.id } }), 200);
  assert.ok(loginSent.extraction.every((item) => item.ok), JSON.stringify(loginSent.extraction));
  const revealed = await expectStatus("revela ambiente", request("/api/apis/reveal", { method: "POST", token: master, body: { target: "environment", id: env.id } }), 200);
  const vars = Object.fromEntries(revealed.variables.map((item) => [item.key, item.value]));
  assert.equal(vars.token, "extracted-token-xyz");
  assert.equal(vars.sessao, "abc123");
  assert.equal(vars.primeiroId, "7");
  await expectStatus("usuario nao revela segredos", request("/api/apis/reveal", { method: "POST", token: userToken, body: { target: "environment", id: env.id } }), 403);

  const oauthRequest = await expectStatus("cria requisicao oauth2", request("/api/apis/requests", { method: "POST", token: master, body: {
    collectionId: collection.id, name: "OAuth", method: "GET", url: "{{baseUrl}}/echo", authType: "oauth2",
    authConfig: { tokenUrl: "{{baseUrl}}/oauth/token", clientId: "cli", clientSecret: "sec", scope: "read", credentialsLocation: "basic_auth_header" }
  } }), 201);
  assert.equal(oauthRequest.authConfig.clientSecret, "__SECRET_UNCHANGED__");
  const oauth1 = await request(`/api/apis/requests/${oauthRequest.id}/send`, { method: "POST", token: master, body: { environmentId: env.id } });
  const oauth2 = await request(`/api/apis/requests/${oauthRequest.id}/send`, { method: "POST", token: master, body: { environmentId: env.id } });
  assert.equal(JSON.parse(oauth1.data.body).headers.authorization, "Bearer tok-1");
  assert.equal(oauth2.data.auth.tokenFromCache, true);
  assert.equal(tokenRequests, 1);
  passed += 1;

  const gzipRequest = await request("/api/apis/requests", { method: "POST", token: master, body: { collectionId: collection.id, name: "Gzip", url: `${ECHO}/gzip`, authType: "none" } });
  const gzipSent = await request(`/api/apis/requests/${gzipRequest.data.id}/send`, { method: "POST", token: master, body: {} });
  assert.deepEqual(JSON.parse(gzipSent.data.body), { compressed: true });
  const offline = await request(`/api/apis/requests/${gzipRequest.data.id}/send`, { method: "POST", token: master, body: { draft: { url: "http://127.0.0.1:1/nada" } } });
  assert.equal(offline.data.ok, false);
  assert.match(offline.data.errorMessage, /recusada|ECONNREFUSED/);
  passed += 2;

  const history = await expectStatus("historico de requisicoes", request(`/api/apis/requests/${echoRequest.id}/history`, { token: master }), 200);
  assert.equal(history.length, 2);
  const tree = await expectStatus("arvore da colecao", request(`/api/apis/collections/${collection.id}`, { token: userToken }), 200);
  assert.equal(tree.folders.length, 2);
  assert.equal(tree.requests.length, 4);
  await expectStatus("usuario nao edita requisicao", request(`/api/apis/requests/${echoRequest.id}`, { method: "PATCH", token: userToken, body: { name: "x" } }), 403);
  await expectStatus("ciclo de pastas bloqueado", request(`/api/apis/collections/${collection.id}/reorder`, { method: "POST", token: master, body: { folders: [{ id: folder.id, parentId: subfolder.id, sortOrder: 0 }] } }), 400);
  await expectStatus("move requisicao para raiz", request(`/api/apis/collections/${collection.id}/reorder`, { method: "POST", token: master, body: { requests: [{ id: echoRequest.id, folderId: null, sortOrder: 0 }] } }), 200);

  const curl = await expectStatus("parse cURL", request("/api/apis/parse-curl", { method: "POST", token: master, body: {
    command: `curl -X POST 'https://api.exemplo.com/v1/itens?x=1' -H 'Authorization: Bearer abc' -H "Content-Type: application/json" --data-raw '{"a":1}' -k`
  } }), 200);
  assert.equal(curl.method, "POST");
  assert.equal(curl.authType, "bearer");
  assert.equal(curl.bodyType, "json");
  assert.equal(curl.settings.insecureTls, true);

  const postman = {
    info: { name: "Postman Importada", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{tk}}" }] },
    variable: [{ key: "base", value: "https://x.com" }, { key: "tk", value: "abc" }],
    item: [{ name: "Pasta", item: [{ name: "Listar", request: { method: "GET", url: { raw: "{{base}}/itens?page=1", query: [{ key: "page", value: "1" }] } } }] }]
  };
  const imported = await expectStatus("importa Postman", request("/api/apis/import", { method: "POST", token: master, body: { content: JSON.stringify(postman) } }), 201);
  assert.equal(imported.requestCount, 1);
  const importedTree = (await request(`/api/apis/collections/${imported.collections[0].id}`, { token: master })).data;
  assert.equal(importedTree.collection.authType, "bearer");
  assert.equal(importedTree.environments[0].variables.find((item) => item.key === "tk").secret, true);
  const exported = await expectStatus("exporta colecao", request(`/api/apis/collections/${collection.id}/export`, { token: master }), 200);
  assert.ok(exported.info.schema.includes("v2.1.0"));
  assert.ok(!JSON.stringify(exported).includes("segredo-123"), "segredos nao exportados");

  const deletion = await expectStatus("exclui pasta com conteudo", request(`/api/apis/folders/${folder.id}`, { method: "DELETE", token: master }), 200);
  assert.equal(deletion.deletedFolders, 2);
  await expectStatus("exclui colecao", request(`/api/apis/collections/${collection.id}`, { method: "DELETE", token: master }), 204);

  console.log(`\n✔ Teste de fumaca concluido: ${passed} verificacoes aprovadas.`);
} catch (error) {
  console.error("\n✖ Falha no teste de fumaca:", error.message);
  console.error(String(error.stack || "").split("\n").find((line) => line.includes("smoke-test.mjs")) || "");
  console.error("\n--- Logs do servidor ---\n", serverLogs.slice(-4000));
  process.exitCode = 1;
} finally {
  server.kill();
  echo.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
