import fs from "node:fs";
import crypto from "node:crypto";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { config } from "./config.js";
import { createPasswordHash } from "./lib/security.js";
import { encryptLegacyAuthConfig, normalizeAuthType } from "./apis/secrets.js";
import { normalizeSchedule } from "./rpa/schedule.js";

let dbInstance = null;
let dbPromise = null;

export async function getDb() {
  if (dbInstance) return dbInstance;
  if (!dbPromise) {
    dbPromise = (async () => {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const db = await open({ filename: config.dbPath, driver: sqlite3.Database });
      await db.exec("PRAGMA foreign_keys = ON;");
      await db.exec("PRAGMA journal_mode = WAL;");
      await db.exec("PRAGMA busy_timeout = 5000;");
      dbInstance = db;
      return db;
    })();
  }
  return dbPromise;
}

export async function closeDb() {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    dbPromise = null;
  }
}

/** Executa uma funcao dentro de uma transacao. */
export async function withTransaction(db, fn) {
  await db.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

// ─── Schema alvo ──────────────────────────────────────────────────────────────
const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    appliedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    createdByUserId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    passwordSalt TEXT NOT NULL,
    foto TEXT,
    tema TEXT NOT NULL DEFAULT 'light',
    role TEXT NOT NULL DEFAULT 'user',
    active INTEGER NOT NULL DEFAULT 1,
    isMaster INTEGER NOT NULL DEFAULT 0,
    departmentId TEXT,
    createdByUserId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    lastLoginAt TEXT,
    passwordChangedAt TEXT,
    FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    tokenHash TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT,
    userAgent TEXT,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    tokenHash TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    repositorio TEXT,
    status TEXT NOT NULL DEFAULT 'ativo',
    tecnologias TEXT NOT NULL DEFAULT '[]',
    categoria TEXT NOT NULL DEFAULT 'interno',
    screenshot TEXT,
    observacoes TEXT,
    createdByUserId TEXT,
    systemType TEXT NOT NULL DEFAULT 'common',
    responsibleUserId TEXT,
    departmentId TEXT,
    runtimeLanguage TEXT,
    code TEXT,
    scheduleConfig TEXT,
    timeoutSeconds INTEGER NOT NULL DEFAULT 600,
    browserMode TEXT NOT NULL DEFAULT 'auto',
    runnerId TEXT,
    lastValidationStatus TEXT,
    lastValidationMessage TEXT,
    lastRunStatus TEXT,
    lastRunAt TEXT,
    lastRunOutput TEXT,
    dataCriacao TEXT NOT NULL,
    dataAtualizacao TEXT NOT NULL,
    FOREIGN KEY (responsibleUserId) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY (runnerId) REFERENCES rpa_runners(id) ON DELETE SET NULL
  );

  -- Servidores de execucao remotos (ex.: Windows com o agente instalado).
  CREATE TABLE IF NOT EXISTS rpa_runners (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    password TEXT,
    tokenHash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    agentInfo TEXT,
    lastSeenAt TEXT,
    createdByUserId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    fileName TEXT NOT NULL,
    mimeType TEXT,
    fileSize INTEGER NOT NULL DEFAULT 0,
    content BLOB NOT NULL,
    createdByUserId TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_runs (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    triggeredByUserId TEXT,
    triggerType TEXT NOT NULL,
    triggerValue TEXT,
    language TEXT,
    status TEXT NOT NULL,
    exitCode INTEGER,
    durationMs INTEGER,
    stdout TEXT,
    stderr TEXT,
    errorMessage TEXT,
    events TEXT,
    lastScreenshot TEXT,
    cancelledByUserId TEXT,
    runnerId TEXT,
    runnerName TEXT,
    createdAt TEXT NOT NULL,
    finishedAt TEXT,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_run_artifacts (
    id TEXT PRIMARY KEY,
    runId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    fileName TEXT NOT NULL,
    mimeType TEXT,
    fileSize INTEGER NOT NULL DEFAULT 0,
    content BLOB NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (runId) REFERENCES project_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipientUserId TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    targetType TEXT,
    targetId TEXT,
    metadata TEXT,
    readAt TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (recipientUserId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL DEFAULT 'external',
    authType TEXT NOT NULL DEFAULT 'none',
    authConfig TEXT,
    activeEnvironmentId TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdByUserId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_folders (
    id TEXT PRIMARY KEY,
    collectionId TEXT NOT NULL,
    parentId TEXT,
    name TEXT NOT NULL,
    description TEXT,
    authType TEXT NOT NULL DEFAULT 'inherit',
    authConfig TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (collectionId) REFERENCES api_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (parentId) REFERENCES api_folders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_requests (
    id TEXT PRIMARY KEY,
    collectionId TEXT NOT NULL,
    folderId TEXT,
    name TEXT NOT NULL,
    description TEXT,
    method TEXT NOT NULL DEFAULT 'GET',
    url TEXT NOT NULL DEFAULT '',
    queryParams TEXT,
    headers TEXT,
    bodyType TEXT NOT NULL DEFAULT 'none',
    bodyContent TEXT,
    formFields TEXT,
    authType TEXT NOT NULL DEFAULT 'inherit',
    authConfig TEXT,
    settings TEXT,
    postResponse TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdByUserId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (collectionId) REFERENCES api_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (folderId) REFERENCES api_folders(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS api_environments (
    id TEXT PRIMARY KEY,
    collectionId TEXT NOT NULL,
    name TEXT NOT NULL,
    variables TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (collectionId) REFERENCES api_collections(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_request_history (
    id TEXT PRIMARY KEY,
    requestId TEXT,
    collectionId TEXT,
    executedByUserId TEXT,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    requestHeaders TEXT,
    requestBody TEXT,
    statusCode INTEGER,
    statusText TEXT,
    durationMs INTEGER,
    responseSize INTEGER,
    responseHeaders TEXT,
    responseBody TEXT,
    errorMessage TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (requestId) REFERENCES api_requests(id) ON DELETE SET NULL,
    FOREIGN KEY (collectionId) REFERENCES api_collections(id) ON DELETE CASCADE
  );
`;

const INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_users_departmentId ON users(departmentId);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_userId ON user_sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_expiresAt ON user_sessions(expiresAt);
  CREATE INDEX IF NOT EXISTS idx_password_reset_userId ON password_reset_tokens(userId);
  CREATE INDEX IF NOT EXISTS idx_projects_responsibleUserId ON projects(responsibleUserId);
  CREATE INDEX IF NOT EXISTS idx_projects_departmentId ON projects(departmentId);
  CREATE INDEX IF NOT EXISTS idx_projects_runnerId ON projects(runnerId);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rpa_runners_tokenHash ON rpa_runners(tokenHash);
  CREATE INDEX IF NOT EXISTS idx_project_files_projectId ON project_files(projectId);
  CREATE INDEX IF NOT EXISTS idx_project_runs_projectId ON project_runs(projectId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_project_runs_status ON project_runs(status);
  CREATE INDEX IF NOT EXISTS idx_project_run_artifacts_runId ON project_run_artifacts(runId);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipientUserId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_api_folders_collectionId ON api_folders(collectionId);
  CREATE INDEX IF NOT EXISTS idx_api_requests_collectionId ON api_requests(collectionId);
  CREATE INDEX IF NOT EXISTS idx_api_requests_folderId ON api_requests(folderId);
  CREATE INDEX IF NOT EXISTS idx_api_environments_collectionId ON api_environments(collectionId);
  CREATE INDEX IF NOT EXISTS idx_api_history_requestId ON api_request_history(requestId, createdAt);
`;

// ─── Utilitarios de migracao ──────────────────────────────────────────────────
async function tableExists(db, name) {
  return Boolean(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name));
}

async function columnNames(db, table) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}

async function ensureColumn(db, table, column, definition) {
  if (!(await tableExists(db, table))) return;
  const columns = await columnNames(db, table);
  if (!columns.includes(column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function dataUrlToBuffer(value) {
  const text = String(value || "");
  const match = text.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { mimeType, buffer };
}

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

// ─── Migracoes (idempotentes, registradas em schema_migrations) ──────────────
const MIGRATIONS = [
  {
    id: "2026-09-29-01-user-columns",
    async run(db) {
      await ensureColumn(db, "users", "role", "TEXT NOT NULL DEFAULT 'user'");
      await ensureColumn(db, "users", "active", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "users", "departmentId", "TEXT");
      await ensureColumn(db, "users", "createdByUserId", "TEXT");
      await ensureColumn(db, "users", "isMaster", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "users", "passwordChangedAt", "TEXT");
      await ensureColumn(db, "departments", "ativo", "INTEGER NOT NULL DEFAULT 1");
      await ensureColumn(db, "departments", "createdByUserId", "TEXT");
      await ensureColumn(db, "user_sessions", "lastSeenAt", "TEXT");
      await ensureColumn(db, "user_sessions", "userAgent", "TEXT");
      await ensureColumn(db, "password_reset_tokens", "attempts", "INTEGER NOT NULL DEFAULT 0");
    }
  },
  {
    id: "2026-09-29-02-remove-tickets",
    async run(db) {
      await db.exec("DROP TABLE IF EXISTS ticket_messages; DROP TABLE IF EXISTS tickets;");
      await db.run("DELETE FROM notifications WHERE kind LIKE 'ticket_%' OR targetType = 'ticket'");
    }
  },
  {
    id: "2026-09-29-03-project-files-blob",
    async run(db) {
      const columns = await columnNames(db, "project_files");
      if (!columns.includes("fileContent")) return;
      const rows = await db.all("SELECT * FROM project_files");
      await db.exec(`
        ALTER TABLE project_files RENAME TO project_files_legacy;
        CREATE TABLE project_files (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          fileName TEXT NOT NULL,
          mimeType TEXT,
          fileSize INTEGER NOT NULL DEFAULT 0,
          content BLOB NOT NULL,
          createdByUserId TEXT,
          createdAt TEXT NOT NULL,
          FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
        );
      `);
      for (const row of rows) {
        const parsed = dataUrlToBuffer(row.fileContent);
        if (!parsed) continue;
        await db.run(
          "INSERT INTO project_files (id, projectId, fileName, mimeType, fileSize, content, createdByUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
          row.id || crypto.randomUUID(), row.projectId, row.fileName || "arquivo", parsed.mimeType, parsed.buffer.length, parsed.buffer, row.createdAt || new Date().toISOString()
        );
      }
      await db.exec("DROP TABLE project_files_legacy;");
    }
  },
  {
    id: "2026-09-29-04-projects-rebuild",
    async run(db) {
      const columns = await columnNames(db, "projects");
      const needsRebuild = ["rpaFile", "rpaFileName", "gestor", "setor"].some((column) => columns.includes(column))
        || !columns.includes("timeoutSeconds") || !columns.includes("browserMode");
      if (!needsRebuild) return;

      // Arquivo unico legado (projects.rpaFile) vira registro em project_files.
      if (columns.includes("rpaFile")) {
        const legacy = await db.all("SELECT id, rpaFile, rpaFileName, dataAtualizacao FROM projects WHERE rpaFile IS NOT NULL AND rpaFile <> ''");
        for (const row of legacy) {
          const fileName = row.rpaFileName || "input_file.xlsx";
          const exists = await db.get("SELECT id FROM project_files WHERE projectId = ? AND fileName = ?", row.id, fileName);
          if (exists) continue;
          const parsed = dataUrlToBuffer(row.rpaFile);
          if (!parsed) continue;
          await db.run(
            "INSERT INTO project_files (id, projectId, fileName, mimeType, fileSize, content, createdByUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
            crypto.randomUUID(), row.id, fileName, parsed.mimeType, parsed.buffer.length, parsed.buffer, row.dataAtualizacao || new Date().toISOString()
          );
        }
      }

      const target = [
        "id", "nome", "descricao", "url", "repositorio", "status", "tecnologias", "categoria", "screenshot", "observacoes",
        "createdByUserId", "systemType", "responsibleUserId", "departmentId", "runtimeLanguage", "code", "scheduleConfig",
        "timeoutSeconds", "browserMode", "lastValidationStatus", "lastValidationMessage", "lastRunStatus", "lastRunAt",
        "lastRunOutput", "dataCriacao", "dataAtualizacao"
      ];
      const shared = target.filter((column) => columns.includes(column));
      await db.exec("PRAGMA foreign_keys = OFF;");
      await db.exec(`
        CREATE TABLE projects__new (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          descricao TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          repositorio TEXT,
          status TEXT NOT NULL DEFAULT 'ativo',
          tecnologias TEXT NOT NULL DEFAULT '[]',
          categoria TEXT NOT NULL DEFAULT 'interno',
          screenshot TEXT,
          observacoes TEXT,
          createdByUserId TEXT,
          systemType TEXT NOT NULL DEFAULT 'common',
          responsibleUserId TEXT,
          departmentId TEXT,
          runtimeLanguage TEXT,
          code TEXT,
          scheduleConfig TEXT,
          timeoutSeconds INTEGER NOT NULL DEFAULT 600,
          browserMode TEXT NOT NULL DEFAULT 'auto',
          lastValidationStatus TEXT,
          lastValidationMessage TEXT,
          lastRunStatus TEXT,
          lastRunAt TEXT,
          lastRunOutput TEXT,
          dataCriacao TEXT NOT NULL,
          dataAtualizacao TEXT NOT NULL,
          FOREIGN KEY (responsibleUserId) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL
        );
        INSERT INTO projects__new (${shared.join(", ")}) SELECT ${shared.join(", ")} FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects__new RENAME TO projects;
      `);
      await db.exec("PRAGMA foreign_keys = ON;");
    }
  },
  {
    id: "2026-09-29-05-run-columns",
    async run(db) {
      for (const [column, definition] of [
        ["triggeredByUserId", "TEXT"], ["triggerValue", "TEXT"], ["language", "TEXT"], ["exitCode", "INTEGER"],
        ["durationMs", "INTEGER"], ["errorMessage", "TEXT"], ["events", "TEXT"], ["lastScreenshot", "TEXT"],
        ["cancelledByUserId", "TEXT"], ["finishedAt", "TEXT"]
      ]) {
        await ensureColumn(db, "project_runs", column, definition);
      }
    }
  },
  {
    id: "2026-09-29-06-schedule-v2",
    async run(db) {
      const rows = await db.all("SELECT id, scheduleConfig, systemType FROM projects");
      for (const row of rows) {
        const current = safeJson(row.scheduleConfig, {});
        if (current?.version === 2) continue;
        const normalized = row.systemType === "rpa" ? normalizeSchedule(current) : normalizeSchedule({ mode: "manual" });
        await db.run("UPDATE projects SET scheduleConfig = ? WHERE id = ?", JSON.stringify(normalized), row.id);
      }
    }
  },
  {
    id: "2026-09-29-07-legacy-apis",
    async run(db) {
      if (!(await tableExists(db, "apis"))) return;
      const requestColumns = await columnNames(db, "api_requests");
      const legacyRequestsTable = requestColumns.includes("apiId") ? "api_requests_legacy" : null;
      if (legacyRequestsTable) {
        // legacy_alter_table evita que o SQLite reescreva as FKs de outras tabelas
        // (ex.: api_request_history) para apontarem para a tabela renomeada.
        await db.exec("PRAGMA foreign_keys = OFF;");
        await db.exec("PRAGMA legacy_alter_table = ON;");
        await db.exec("ALTER TABLE api_requests RENAME TO api_requests_legacy;");
        await db.exec("PRAGMA legacy_alter_table = OFF;");
        await db.exec(BASE_SCHEMA);
        await db.exec("PRAGMA foreign_keys = ON;");
      }

      const collections = await db.all("SELECT * FROM apis ORDER BY createdAt ASC");
      let order = 0;
      for (const item of collections) {
        const exists = await db.get("SELECT id FROM api_collections WHERE id = ?", item.id);
        if (exists) continue;
        await db.run(
          `INSERT INTO api_collections (id, name, description, scope, authType, authConfig, activeEnvironmentId, sortOrder, createdByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, 'external', 'none', '{}', NULL, ?, ?, ?, ?)`,
          item.id, item.name, item.description || "", order++, item.createdByUserId || null, item.createdAt, item.updatedAt
        );
      }

      if (legacyRequestsTable) {
        const requests = await db.all(`SELECT * FROM ${legacyRequestsTable} ORDER BY sortOrder ASC, createdAt ASC`);
        for (const item of requests) {
          const exists = await db.get("SELECT id FROM api_requests WHERE id = ?", item.id);
          if (exists) continue;
          const legacyBodyType = String(item.bodyType || "none");
          const bodyType = legacyBodyType === "raw_json" ? "json" : ["none", "text", "form_urlencoded"].includes(legacyBodyType) ? legacyBodyType : "text";
          const formFields = bodyType === "form_urlencoded"
            ? [...new URLSearchParams(item.bodyContent || "")].map(([key, value]) => ({ key, value, enabled: true }))
            : [];
          const authType = normalizeAuthType(item.authType, { allowInherit: false });
          const authConfig = encryptLegacyAuthConfig(authType, safeJson(item.authConfig, {}));
          const settings = { timeoutMs: 30000, followRedirects: true, insecureTls: Boolean(item.insecureTls) };
          await db.run(
            `INSERT INTO api_requests (id, collectionId, folderId, name, description, method, url, queryParams, headers, bodyType, bodyContent, formFields,
               authType, authConfig, settings, postResponse, sortOrder, createdByUserId, createdAt, updatedAt)
             VALUES (?, ?, NULL, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
            item.id, item.apiId, item.name, String(item.method || "GET").toUpperCase(), item.url || "",
            item.queryParams || "[]", item.headers || "[]", bodyType, bodyType === "form_urlencoded" ? "" : item.bodyContent || "",
            JSON.stringify(formFields), authType, JSON.stringify(authConfig), JSON.stringify(settings),
            item.sortOrder || 0, item.createdByUserId || null, item.createdAt, item.updatedAt
          );
        }
      }

      if (await tableExists(db, "api_request_runs")) {
        const runs = await db.all("SELECT r.*, q.collectionId FROM api_request_runs r LEFT JOIN api_requests q ON q.id = r.requestId");
        for (const run of runs) {
          const exists = await db.get("SELECT id FROM api_request_history WHERE id = ?", run.id);
          if (exists || !run.collectionId) continue;
          await db.run(
            `INSERT INTO api_request_history (id, requestId, collectionId, executedByUserId, method, url, requestHeaders, requestBody, statusCode, statusText,
               durationMs, responseSize, responseHeaders, responseBody, errorMessage, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, '{}', '', ?, '', ?, ?, ?, ?, ?, ?)`,
            run.id, run.requestId, run.collectionId, run.executedByUserId || null, run.method, run.url,
            run.statusCode ?? null, run.durationMs ?? null, Buffer.byteLength(run.responseBody || ""),
            run.responseHeaders || "{}", run.responseBody || "", run.errorMessage || "", run.createdAt
          );
        }
      }

      await db.exec("PRAGMA foreign_keys = OFF;");
      await db.exec("DROP TABLE IF EXISTS api_request_runs; DROP TABLE IF EXISTS api_requests_legacy; DROP TABLE IF EXISTS apis;");
      await db.exec("PRAGMA foreign_keys = ON;");
    }
  },
  {
    // Reparo: bancos migrados pela versao inicial da migracao 07 ficaram com
    // FKs apontando para tabelas "*_legacy" ja removidas. Reconstroi essas tabelas.
    id: "2026-09-29-08-repair-legacy-references",
    async run(db) {
      const broken = await db.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%_legacy' AND sql LIKE '%\\_legacy%' ESCAPE '\\'"
      );
      for (const { name } of broken) {
        const canonical = BASE_SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n  \\);`));
        if (!canonical) continue;
        const columns = await columnNames(db, name);
        await db.exec("PRAGMA foreign_keys = OFF;");
        await db.exec("PRAGMA legacy_alter_table = ON;");
        await db.exec(`ALTER TABLE ${name} RENAME TO ${name}__broken;`);
        await db.exec("PRAGMA legacy_alter_table = OFF;");
        await db.exec(`CREATE TABLE ${name} (${canonical[1]}\n);`);
        const target = await columnNames(db, name);
        const shared = columns.filter((column) => target.includes(column));
        await db.exec(`INSERT INTO ${name} (${shared.join(", ")}) SELECT ${shared.join(", ")} FROM ${name}__broken;`);
        await db.exec(`DROP TABLE ${name}__broken;`);
        await db.exec("PRAGMA foreign_keys = ON;");
        console.log(`[db] Tabela reparada: ${name}`);
      }
    }
  },
  {
    id: "2026-10-09-01-remote-runners",
    async run(db) {
      await ensureColumn(db, "projects", "runnerId", "TEXT REFERENCES rpa_runners(id) ON DELETE SET NULL");
      await ensureColumn(db, "project_runs", "runnerId", "TEXT");
      await ensureColumn(db, "project_runs", "runnerName", "TEXT");
    }
  }
];

async function runMigrations(db) {
  const applied = new Set((await db.all("SELECT id FROM schema_migrations")).map((row) => row.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    await migration.run(db);
    await db.run("INSERT INTO schema_migrations (id, appliedAt) VALUES (?, ?)", migration.id, new Date().toISOString());
    console.log(`[db] Migracao aplicada: ${migration.id}`);
  }
}

async function ensureDefaultDepartment(db) {
  const existing = await db.get("SELECT id FROM departments WHERE nome = ?", "Tecnologia");
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.run(
    "INSERT INTO departments (id, nome, descricao, ativo, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)",
    id, "Tecnologia", "Departamento padrao para a plataforma.", now, now
  );
  return id;
}

/**
 * Garante o usuario master: nunca altera a senha de um master existente.
 * Apenas assegura que ele continue super_admin, ativo e marcado como master.
 */
async function ensureMasterUser(db, departmentId) {
  const now = new Date().toISOString();
  const existing = await db.get("SELECT id FROM users WHERE email = ?", config.master.email);
  if (existing) {
    await db.run(
      "UPDATE users SET role = 'super_admin', active = 1, isMaster = 1, departmentId = COALESCE(departmentId, ?) WHERE id = ?",
      departmentId, existing.id
    );
    await db.run("UPDATE users SET isMaster = 0 WHERE isMaster = 1 AND id <> ?", existing.id);
    return;
  }

  let password = config.master.password;
  if (!password) {
    password = `Mst-${crypto.randomBytes(9).toString("base64url")}9`;
    console.warn("[db] ================================================================");
    console.warn(`[db] Usuario master criado: ${config.master.email}`);
    console.warn(`[db] Senha temporaria gerada: ${password}`);
    console.warn("[db] Defina MASTER_PASSWORD no .env ou altere a senha apos o primeiro login.");
    console.warn("[db] ================================================================");
  }
  const { salt, hash } = createPasswordHash(password);
  await db.run(
    `INSERT INTO users (id, nome, email, passwordHash, passwordSalt, foto, tema, role, active, isMaster, departmentId, createdAt, updatedAt, passwordChangedAt)
     VALUES (?, ?, ?, ?, ?, '', 'light', 'super_admin', 1, 1, ?, ?, ?, ?)`,
    crypto.randomUUID(), config.master.name, config.master.email, hash, salt, departmentId, now, now, now
  );
}

export async function initDb() {
  const db = await getDb();
  await db.exec(BASE_SCHEMA);
  await runMigrations(db);
  await db.exec(BASE_SCHEMA);
  await db.exec(INDEXES);
  const departmentId = await ensureDefaultDepartment(db);
  await ensureMasterUser(db, departmentId);
  await db.run("DELETE FROM user_sessions WHERE expiresAt <= ?", new Date().toISOString());
  return db;
}
