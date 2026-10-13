import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { closeDb, initDb } from "./db.js";
import { requireManager } from "./lib/auth.js";
import { HttpError } from "./lib/http.js";
import { isMailConfigured } from "./lib/mailer.js";
import { runtimeDiagnostics } from "./rpa/interpreters.js";
import { recoverInterruptedRuns, stopAllRuns } from "./rpa/runner.js";
import { startScheduler, stopScheduler } from "./rpa/scheduler.js";
import agentRouter from "./routes/agent.js";
import apisRouter from "./routes/apis.js";
import authRouter from "./routes/auth.js";
import departmentsRouter from "./routes/departments.js";
import notificationsRouter from "./routes/notifications.js";
import projectsRouter from "./routes/projects.js";
import runnersRouter from "./routes/runners.js";
import runsRouter from "./routes/runs.js";
import usersRouter from "./routes/users.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "8mb" }));

// release = commit publicado pelo CI/CD (permite conferir na VPS qual versao esta no ar).
app.get("/api/health", (_req, res) => res.json({ ok: true, version: "2.0.0", release: process.env.RELEASE_SHA || "development" }));
app.get("/api/system/runtime", requireManager, (_req, res) => {
  res.json({ ...runtimeDiagnostics(), mailConfigured: isMailConfigured(), timezone: config.timezone, maxConcurrentRuns: config.rpa.maxConcurrent });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/runs", runsRouter);
app.use("/api/runners", runnersRouter);
app.use("/api/agent", agentRouter);
app.use("/api/apis", apisRouter);

app.use("/api", (_req, _res, next) => next(new HttpError(404, "Rota da API nao encontrada.")));

if (fs.existsSync(config.distPath)) {
  app.use(express.static(config.distPath, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(config.distPath, "index.html")));
}

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, ...error.extra });
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Conteudo excede o tamanho maximo permitido." });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON invalido no corpo da requisicao." });
  }
  if (error?.code === "SQLITE_CONSTRAINT") {
    return res.status(409).json({ error: "Violacao de integridade no banco de dados." });
  }
  console.error(error);
  return res.status(500).json({ error: "Erro interno do servidor." });
});

await initDb();
await recoverInterruptedRuns();
startScheduler();

const server = app.listen(config.port, () => {
  console.log(`API rodando em http://localhost:${config.port} (banco: ${config.dbPath})`);
});

async function shutdown(signal) {
  console.log(`[server] ${signal} recebido. Encerrando...`);
  stopScheduler();
  stopAllRuns();
  server.close();
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
