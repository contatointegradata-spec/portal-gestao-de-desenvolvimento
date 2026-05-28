import path from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH?.trim()
  ? path.resolve(process.cwd(), process.env.DB_PATH.trim())
  : path.resolve(__dirname, "..", "gestao_dev_unimed");
const MASTER_USER = {
  nome: "Kelven Silva",
  email: "kelvensilva.unimed@gmail.com",
  password: "Saladas.2",
  role: "super_admin"
};

let dbInstance = null;

export async function initDb() {
  const db = await getDb();

  await db.exec(`
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
      tema TEXT NOT NULL DEFAULT 'dark',
      role TEXT NOT NULL DEFAULT 'user',
      active INTEGER NOT NULL DEFAULT 1,
      departmentId TEXT,
      createdByUserId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastLoginAt TEXT,
      FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL,
      url TEXT NOT NULL,
      repositorio TEXT,
      status TEXT NOT NULL,
      tecnologias TEXT NOT NULL,
      categoria TEXT NOT NULL,
      screenshot TEXT,
      observacoes TEXT,
      createdByUserId TEXT,
      systemType TEXT NOT NULL DEFAULT 'common',
      responsibleUserId TEXT,
      departmentId TEXT,
      runtimeLanguage TEXT,
      code TEXT,
      scheduleConfig TEXT,
      lastValidationStatus TEXT,
      lastValidationMessage TEXT,
      lastRunStatus TEXT,
      lastRunAt TEXT,
      lastRunOutput TEXT,
      rpaFile TEXT,
      dataCriacao TEXT NOT NULL,
      dataAtualizacao TEXT NOT NULL,
      FOREIGN KEY (responsibleUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL
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
      createdAt TEXT NOT NULL,
      finishedAt TEXT,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      titulo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      categoria TEXT NOT NULL,
      prioridade TEXT NOT NULL DEFAULT 'media',
      status TEXT NOT NULL DEFAULT 'aberto',
      requesterUserId TEXT,
      requesterName TEXT NOT NULL,
      requesterEmail TEXT NOT NULL,
      assignedUserId TEXT,
      departmentId TEXT,
      projectId TEXT,
      systemType TEXT NOT NULL DEFAULT 'common',
      resolutionSummary TEXT,
      resolvedAt TEXT,
      closedAt TEXT,
      lastRequesterReplyAt TEXT,
      lastAgentReplyAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (requesterUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assignedUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      authorUserId TEXT,
      authorName TEXT NOT NULL,
      authorEmail TEXT NOT NULL,
      authorRole TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      messageType TEXT NOT NULL DEFAULT 'message',
      body TEXT NOT NULL,
      fromStatus TEXT,
      toStatus TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (ticketId) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (authorUserId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      fileContent TEXT NOT NULL,
      fileSize INTEGER,
      createdAt TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_project_files_projectId ON project_files(projectId);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipientUserId ON notifications(recipientUserId);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_userId ON user_sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expiresAt ON user_sessions(expiresAt);
    CREATE INDEX IF NOT EXISTS idx_password_reset_userId ON password_reset_tokens(userId);
    CREATE INDEX IF NOT EXISTS idx_password_reset_expiresAt ON password_reset_tokens(expiresAt);
  `);

  await ensureLegacyColumns(db);
  await ensureIndexes(db);
  const defaultDepartmentId = await ensureDefaultDepartment(db);
  await ensureMasterUser(db, defaultDepartmentId);
  await migrateProjectSchema(db);
  await migrateTicketSchema(db);
}

export async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await dbInstance.exec("PRAGMA foreign_keys = ON;");
  return dbInstance;
}

async function ensureLegacyColumns(db) {
  await ensureColumn(db, "users", "role", "TEXT NOT NULL DEFAULT 'user'");
  await ensureColumn(db, "users", "active", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "users", "departmentId", "TEXT");
  await ensureColumn(db, "users", "createdByUserId", "TEXT");
  await ensureColumn(db, "departments", "ativo", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "departments", "createdByUserId", "TEXT");
  await ensureColumn(db, "projects", "createdByUserId", "TEXT");
  await ensureColumn(db, "projects", "systemType", "TEXT NOT NULL DEFAULT 'common'");
  await ensureColumn(db, "projects", "responsibleUserId", "TEXT");
  await ensureColumn(db, "projects", "departmentId", "TEXT");
  await ensureColumn(db, "projects", "runtimeLanguage", "TEXT");
  await ensureColumn(db, "projects", "code", "TEXT");
  await ensureColumn(db, "projects", "scheduleConfig", "TEXT");
  await ensureColumn(db, "projects", "lastValidationStatus", "TEXT");
  await ensureColumn(db, "projects", "lastValidationMessage", "TEXT");
  await ensureColumn(db, "projects", "lastRunStatus", "TEXT");
  await ensureColumn(db, "projects", "lastRunAt", "TEXT");
  await ensureColumn(db, "projects", "lastRunOutput", "TEXT");
  await ensureColumn(db, "projects", "rpaFile", "TEXT");
  await ensureColumn(db, "projects", "rpaFileName", "TEXT");
  await ensureColumn(db, "project_runs", "triggeredByUserId", "TEXT");
  await ensureColumn(db, "project_runs", "triggerValue", "TEXT");
  await ensureColumn(db, "project_runs", "language", "TEXT");
  await ensureColumn(db, "project_runs", "exitCode", "INTEGER");
  await ensureColumn(db, "project_runs", "durationMs", "INTEGER");
  await ensureColumn(db, "project_runs", "errorMessage", "TEXT");
  await ensureColumn(db, "tickets", "requesterName", "TEXT");
  await ensureColumn(db, "tickets", "requesterEmail", "TEXT");
  await ensureColumn(db, "ticket_messages", "authorName", "TEXT");
  await ensureColumn(db, "ticket_messages", "authorEmail", "TEXT");
  await ensureColumn(db, "ticket_messages", "authorRole", "TEXT");
  await ensureColumn(db, "tickets", "systemType", "TEXT NOT NULL DEFAULT 'common'");
}

async function ensureIndexes(db) {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_departmentId ON users(departmentId);
    CREATE INDEX IF NOT EXISTS idx_projects_responsibleUserId ON projects(responsibleUserId);
    CREATE INDEX IF NOT EXISTS idx_projects_departmentId ON projects(departmentId);
    CREATE INDEX IF NOT EXISTS idx_project_runs_projectId ON project_runs(projectId);
    CREATE INDEX IF NOT EXISTS idx_tickets_requesterUserId ON tickets(requesterUserId);
    CREATE INDEX IF NOT EXISTS idx_tickets_assignedUserId ON tickets(assignedUserId);
    CREATE INDEX IF NOT EXISTS idx_tickets_departmentId ON tickets(departmentId);
    CREATE INDEX IF NOT EXISTS idx_tickets_projectId ON tickets(projectId);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticketId ON ticket_messages(ticketId);
    CREATE INDEX IF NOT EXISTS idx_ticket_messages_authorUserId ON ticket_messages(authorUserId);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipientUserId ON notifications(recipientUserId);
    CREATE INDEX IF NOT EXISTS idx_notifications_readAt ON notifications(readAt);
    CREATE INDEX IF NOT EXISTS idx_notifications_createdAt ON notifications(createdAt);
  `);
}

async function ensureColumn(db, tableName, columnName, definition) {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureDefaultDepartment(db) {
  const existing = await db.get("SELECT id FROM departments WHERE nome = ?", "Tecnologia");
  if (existing) return existing.id;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.run(
    "INSERT INTO departments (id, nome, descricao, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    id,
    "Tecnologia",
    "Departamento padrao para a plataforma.",
    now,
    now
  );

  return id;
}

async function migrateProjectSchema(db) {
  const projectColumns = await db.all("PRAGMA table_info(projects)");
  if (!projectColumns.length) return;

  const hasGestor = projectColumns.some((column) => column.name === "gestor");
  const hasSetor = projectColumns.some((column) => column.name === "setor");
  if (!hasGestor && !hasSetor) return;

  await db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE projects__new (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL,
      url TEXT NOT NULL,
      repositorio TEXT,
      status TEXT NOT NULL,
      tecnologias TEXT NOT NULL,
      categoria TEXT NOT NULL,
      screenshot TEXT,
      observacoes TEXT,
      createdByUserId TEXT,
      systemType TEXT NOT NULL DEFAULT 'common',
      responsibleUserId TEXT,
      departmentId TEXT,
      runtimeLanguage TEXT,
      code TEXT,
      scheduleConfig TEXT,
      lastValidationStatus TEXT,
      lastValidationMessage TEXT,
      lastRunStatus TEXT,
      lastRunAt TEXT,
      lastRunOutput TEXT,
      rpaFile TEXT,
      dataCriacao TEXT NOT NULL,
      dataAtualizacao TEXT NOT NULL,
      FOREIGN KEY (responsibleUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL
    );

    INSERT INTO projects__new (
      id, nome, descricao, url, repositorio, status, tecnologias, categoria, screenshot, observacoes,
      createdByUserId, systemType, responsibleUserId, departmentId, runtimeLanguage, code, scheduleConfig,
      lastValidationStatus, lastValidationMessage, lastRunStatus, lastRunAt, lastRunOutput, rpaFile, dataCriacao, dataAtualizacao
    )
    SELECT
      id, nome, descricao, url, repositorio, status, tecnologias, categoria, screenshot, observacoes,
      createdByUserId, systemType, responsibleUserId, departmentId, runtimeLanguage, code, scheduleConfig,
      lastValidationStatus, lastValidationMessage, lastRunStatus, lastRunAt, lastRunOutput, rpaFile, dataCriacao, dataAtualizacao
    FROM projects;

    DROP TABLE projects;
    ALTER TABLE projects__new RENAME TO projects;

    PRAGMA foreign_keys = ON;
  `);
}

async function migrateTicketSchema(db) {
  const ticketColumns = await db.all("PRAGMA table_info(tickets)");
  if (!ticketColumns.length) return;

  const hasRequesterSnapshot = ticketColumns.some((column) => column.name === "requesterName");
  if (hasRequesterSnapshot) return;

  const ticketCountRow = await db.get("SELECT COUNT(*) AS count FROM tickets");
  const messageCountRow = await db.get("SELECT COUNT(*) AS count FROM ticket_messages");
  if ((ticketCountRow?.count || 0) > 0 || (messageCountRow?.count || 0) > 0) {
    console.warn("Ticket schema legado detectado com dados existentes. A migracao automatica foi ignorada.");
    return;
  }

  await db.exec(`
    DROP TABLE IF EXISTS ticket_messages;
    DROP TABLE IF EXISTS tickets;

    CREATE TABLE tickets (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      titulo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      categoria TEXT NOT NULL,
      prioridade TEXT NOT NULL DEFAULT 'media',
      status TEXT NOT NULL DEFAULT 'aberto',
      requesterUserId TEXT,
      requesterName TEXT NOT NULL,
      requesterEmail TEXT NOT NULL,
      assignedUserId TEXT,
      departmentId TEXT,
      projectId TEXT,
      resolutionSummary TEXT,
      resolvedAt TEXT,
      closedAt TEXT,
      lastRequesterReplyAt TEXT,
      lastAgentReplyAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (requesterUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assignedUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (departmentId) REFERENCES departments(id) ON DELETE SET NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE ticket_messages (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      authorUserId TEXT,
      authorName TEXT NOT NULL,
      authorEmail TEXT NOT NULL,
      authorRole TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      messageType TEXT NOT NULL DEFAULT 'message',
      body TEXT NOT NULL,
      fromStatus TEXT,
      toStatus TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (ticketId) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (authorUserId) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

async function ensureMasterUser(db, departmentId) {
  const now = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(MASTER_USER.password, salt);
  const existingUser = await db.get("SELECT id FROM users WHERE email = ?", MASTER_USER.email);

  if (existingUser) {
    await db.run(
      `UPDATE users
       SET nome = ?, passwordHash = ?, passwordSalt = ?, role = ?, departmentId = COALESCE(departmentId, ?), updatedAt = ?
       WHERE id = ?`,
      MASTER_USER.nome,
      passwordHash,
      salt,
      MASTER_USER.role,
      departmentId,
      now,
      existingUser.id
    );
    return;
  }

  await db.run(
    `INSERT INTO users
      (id, nome, email, passwordHash, passwordSalt, foto, tema, role, active, departmentId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    MASTER_USER.nome,
    MASTER_USER.email,
    passwordHash,
    salt,
    "",
    "light",
    MASTER_USER.role,
    1,
    departmentId,
    now,
    now
  );
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
