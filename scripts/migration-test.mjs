/**
 * Teste de regressao das migracoes: monta um banco no formato legado
 * (chamados, APIs antigas, arquivos base64, agenda antiga) e valida a migracao.
 *
 * Uso: npm run test:migration
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gestao-migration-"));
const dbPath = path.join(tempDir, "legacy.sqlite");
process.env.DB_PATH = dbPath;
process.env.APP_SECRET_KEY = "migration-test-key";
process.env.MASTER_EMAIL = "master@example.com";

const legacy = await open({ filename: dbPath, driver: sqlite3.Database });
await legacy.exec(`
  CREATE TABLE departments (id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE, descricao TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE users (id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL, passwordSalt TEXT NOT NULL,
    foto TEXT, tema TEXT NOT NULL DEFAULT 'dark', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, lastLoginAt TEXT);
  CREATE TABLE user_sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL);
  CREATE TABLE password_reset_tokens (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, usedAt TEXT);
  CREATE TABLE projects (id TEXT PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL, url TEXT NOT NULL, repositorio TEXT, status TEXT NOT NULL,
    tecnologias TEXT NOT NULL, categoria TEXT NOT NULL, screenshot TEXT, observacoes TEXT, systemType TEXT NOT NULL DEFAULT 'common',
    responsibleUserId TEXT, runtimeLanguage TEXT, code TEXT, scheduleConfig TEXT, lastRunStatus TEXT, lastRunAt TEXT, lastRunOutput TEXT,
    rpaFile TEXT, rpaFileName TEXT, dataCriacao TEXT NOT NULL, dataAtualizacao TEXT NOT NULL);
  CREATE TABLE project_files (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, fileName TEXT NOT NULL, fileContent TEXT NOT NULL, fileSize INTEGER, createdAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE);
  CREATE TABLE project_runs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, triggerType TEXT NOT NULL, status TEXT NOT NULL, stdout TEXT, stderr TEXT,
    createdAt TEXT NOT NULL, FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE);
  CREATE TABLE notifications (id TEXT PRIMARY KEY, recipientUserId TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    targetType TEXT, targetId TEXT, metadata TEXT, readAt TEXT, createdAt TEXT NOT NULL);
  CREATE TABLE tickets (id TEXT PRIMARY KEY, number INTEGER, titulo TEXT);
  CREATE TABLE ticket_messages (id TEXT PRIMARY KEY, ticketId TEXT, body TEXT);
  CREATE TABLE apis (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, createdByUserId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
  CREATE TABLE api_requests (id TEXT PRIMARY KEY, apiId TEXT NOT NULL, name TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', url TEXT NOT NULL,
    queryParams TEXT, headers TEXT, bodyType TEXT NOT NULL DEFAULT 'none', bodyContent TEXT, authType TEXT NOT NULL DEFAULT 'none', authConfig TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0, createdByUserId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, insecureTls INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (apiId) REFERENCES apis(id) ON DELETE CASCADE);
  CREATE TABLE api_request_runs (id TEXT PRIMARY KEY, requestId TEXT NOT NULL, executedByUserId TEXT, method TEXT NOT NULL, url TEXT NOT NULL,
    statusCode INTEGER, durationMs INTEGER, responseHeaders TEXT, responseBody TEXT, errorMessage TEXT, createdAt TEXT NOT NULL,
    FOREIGN KEY (requestId) REFERENCES api_requests(id) ON DELETE CASCADE);
`);
const now = new Date().toISOString();
const dataUrl = `data:text/plain;base64,${Buffer.from("conteudo legado").toString("base64")}`;
await legacy.run("INSERT INTO users VALUES ('u1', 'Master', 'master@example.com', 'hash', 'salt', '', 'dark', ?, ?, NULL)", now, now);
await legacy.run(`INSERT INTO projects VALUES ('p1', 'RPA Legado', 'x', '', '', 'ativo', '["Python"]', 'interno', '', '', 'rpa', 'u1', 'python', 'print(1)',
  '{"mode":"hours","hours":["8:00","12:30"],"dates":[]}', 'success', ?, 'ok', ?, 'planilha.xlsx', ?, ?)`, now, dataUrl, now, now);
await legacy.run("INSERT INTO project_files VALUES ('f1', 'p1', 'extra.txt', ?, 15, ?)", dataUrl, now);
await legacy.run("INSERT INTO project_runs VALUES ('r1', 'p1', 'manual', 'success', 'saida', '', ?)", now);
await legacy.run("INSERT INTO notifications VALUES ('n1', 'u1', 'ticket_created', 't', 'b', 'ticket', 'x', '{}', NULL, ?)", now);
await legacy.run("INSERT INTO notifications VALUES ('n2', 'u1', 'rpa_execution', 't', 'b', 'project', 'p1', '{}', NULL, ?)", now);
await legacy.run("INSERT INTO tickets VALUES ('t1', 1, 'Chamado')");
await legacy.run("INSERT INTO apis VALUES ('a1', 'API Legada', '', 'u1', ?, ?)", now, now);
await legacy.run(`INSERT INTO api_requests VALUES ('q1', 'a1', 'Login', 'post', 'https://x', '[]', '[]', 'raw_json', '{"a":1}', 'oauth2',
  '{"tokenUrl":"https://x/token","clientId":"id","clientSecret":"segredo-legado","credentialsLocation":"body"}', 0, 'u1', ?, ?, 1)`, now, now);
await legacy.run("INSERT INTO api_request_runs VALUES ('h1', 'q1', 'u1', 'POST', 'https://x', 200, 10, '{}', 'ok', '', ?)", now);
await legacy.close();

const { initDb, getDb, closeDb } = await import("../server/db.js");
await initDb();
await initDb(); // idempotente
const db = await getDb();

try {
  const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((row) => row.name);
  for (const removed of ["tickets", "ticket_messages", "apis", "api_request_runs", "api_requests_legacy"]) assert.ok(!tables.includes(removed), `${removed} deveria ter sido removida`);
  assert.equal((await db.all("SELECT name FROM sqlite_master WHERE sql LIKE '%\\_legacy%' ESCAPE '\\'")).length, 0, "nenhuma referencia a tabelas _legacy");
  assert.equal((await db.all("PRAGMA foreign_key_check")).length, 0, "sem violacoes de FK");

  const master = await db.get("SELECT role, active, isMaster, passwordHash FROM users WHERE email = 'master@example.com'");
  assert.deepEqual([master.role, master.active, master.isMaster, master.passwordHash], ["super_admin", 1, 1, "hash"], "master preservado (senha intacta)");

  const files = await db.all("SELECT fileName, typeof(content) AS type, CAST(content AS TEXT) AS text FROM project_files ORDER BY fileName");
  assert.deepEqual(files.map((file) => [file.fileName, file.type, file.text]), [["extra.txt", "blob", "conteudo legado"], ["planilha.xlsx", "blob", "conteudo legado"]]);
  const projectColumns = (await db.all("PRAGMA table_info(projects)")).map((row) => row.name);
  assert.ok(!projectColumns.includes("rpaFile") && projectColumns.includes("timeoutSeconds"));
  const schedule = JSON.parse((await db.get("SELECT scheduleConfig FROM projects WHERE id = 'p1'")).scheduleConfig);
  assert.deepEqual([schedule.version, schedule.mode, schedule.times], [2, "daily", ["08:00", "12:30"]]);

  const notificationKinds = (await db.all("SELECT kind FROM notifications")).map((row) => row.kind);
  assert.deepEqual(notificationKinds, ["rpa_execution"], "notificacoes de chamados removidas");

  const request = await db.get("SELECT * FROM api_requests WHERE id = 'q1'");
  assert.equal(request.collectionId, "a1");
  assert.equal(request.bodyType, "json");
  assert.equal(request.method, "POST");
  assert.ok(JSON.parse(request.authConfig).clientSecret.startsWith("enc:v1:"), "segredo legado criptografado");
  assert.equal(JSON.parse(request.settings).insecureTls, true);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM api_request_history WHERE requestId = 'q1'")).n, 1, "historico migrado");
  await db.run("INSERT INTO api_request_history (id, requestId, collectionId, method, url, createdAt) VALUES ('novo', 'q1', 'a1', 'GET', 'x', ?)", now);

  console.log("✔ Teste de migracao concluido: banco legado convertido sem perdas.");
} catch (error) {
  console.error("✖ Falha no teste de migracao:", error.message);
  process.exitCode = 1;
} finally {
  await closeDb();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
