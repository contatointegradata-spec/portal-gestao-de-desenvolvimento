import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

// Carrega o .env da raiz do projeto (o Docker ja injeta via env_file; aqui cobre o modo local).
const envFile = path.join(ROOT_DIR, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.warn(`[config] Nao foi possivel ler ${envFile}: ${error.message}`);
  }
}

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === "" ? fallback : String(value).trim();
}

function envInt(name, fallback) {
  const parsed = Number.parseInt(env(name, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dbPath = path.resolve(ROOT_DIR, env("DB_PATH", "data/gestao_dev_unimed.sqlite"));

export const config = {
  port: envInt("PORT", 5174),
  nodeEnv: env("NODE_ENV", "development"),
  dbPath,
  dataDir: path.dirname(dbPath),
  distPath: path.join(ROOT_DIR, "dist"),
  timezone: env("APP_TIMEZONE", "America/Sao_Paulo"),
  frontendUrl: env("FRONTEND_URL", ""),
  sessionDurationDays: envInt("SESSION_DURATION_DAYS", 7),
  secretKey: env("APP_SECRET_KEY", ""),
  master: {
    email: env("MASTER_EMAIL", "kelvensilva.unimed@gmail.com").toLowerCase(),
    name: env("MASTER_NAME", "Kelven Silva"),
    // Usada somente quando o usuario master ainda nao existe no banco.
    password: env("MASTER_PASSWORD", "")
  },
  mail: {
    user: env("MAIL_USER", ""),
    password: env("MAIL_APP_PASSWORD", ""),
    from: env("MAIL_FROM", env("MAIL_USER", ""))
  },
  rpa: {
    pythonBin: env("PYTHON_BIN", ""),
    maxConcurrent: envInt("RPA_MAX_CONCURRENT", 3),
    defaultTimeoutSeconds: envInt("RPA_DEFAULT_TIMEOUT_SECONDS", 600),
    // Teto do tempo limite configuravel por RPA (24h). O RPA tambem pode ficar "sem limite" (timeoutSeconds = 0).
    maxTimeoutSeconds: envInt("RPA_MAX_TIMEOUT_SECONDS", 86400),
    maxFileBytes: envInt("RPA_MAX_FILE_MB", 25) * 1024 * 1024,
    headless: env("RPA_HEADLESS", ""),
    // Transmissao ao vivo do navegador do servidor Linux (noVNC). 0 desativa.
    liveViewPort: envInt("RPA_LIVE_VIEW_PORT", 6080),
    // URL publica do noVNC, se ele estiver atras de proxy (padrao: http://<host-da-plataforma>:<porta>).
    liveViewUrl: env("RPA_LIVE_VIEW_URL", "")
  }
};
