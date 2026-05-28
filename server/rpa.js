import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_OUTPUT_CHARS = 12000;
const MAX_CODE_CHARS = 120000;

export const SUPPORTED_LANGUAGES = ["javascript", "python"];

export function normalizeLanguage(language) {
  const value = String(language || "").trim().toLowerCase();
  if (value === "js" || value === "javascript" || value === "node") return "javascript";
  if (value === "py" || value === "python") return "python";
  return "";
}

export function normalizeScheduleValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeRpaProjectPayload(payload = {}) {
  const systemType = payload.systemType === "rpa" ? "rpa" : "common";
  const language = systemType === "rpa" ? normalizeLanguage(payload.language) : "";
  return {
    systemType,
    ownerEmail: String(payload.ownerEmail || "").trim().toLowerCase(),
    ownerName: String(payload.ownerName || "").trim(),
    department: String(payload.department || "").trim(),
    language,
    code: systemType === "rpa" ? String(payload.code || "") : "",
    scheduleMode: systemType === "rpa" ? normalizeScheduleMode(payload.scheduleMode) : "manual",
    scheduleHours: systemType === "rpa" ? String(payload.scheduleHours || "").trim() : "",
    scheduleDates: systemType === "rpa" ? String(payload.scheduleDates || "").trim() : "",
    scheduleNotes: systemType === "rpa" ? String(payload.scheduleNotes || "").trim() : "",
    rpaFile: systemType === "rpa" ? String(payload.rpaFile || "").trim() : "",
    rpaFileName: systemType === "rpa" ? String(payload.rpaFileName || "").trim() : "",
    isRpa: systemType === "rpa"
  };
}

export function validateRpaProjectPayload(payload) {
  const errors = [];
  if (!payload?.nome?.trim()) errors.push("nome");
  if (!payload?.descricao?.trim()) errors.push("descricao");
  if (!payload?.url?.trim()) errors.push("url");
  if (!payload?.status) errors.push("status");
  if (!payload?.categoria) errors.push("categoria");
  if (!Array.isArray(payload?.tecnologias) || payload.tecnologias.length === 0) errors.push("tecnologias");

  const normalized = normalizeRpaProjectPayload(payload);
  if (normalized.isRpa) {
    if (!normalized.language) errors.push("language");
    if (!normalized.code.trim()) errors.push("code");
  }

  return { errors, normalized };
}

export async function validateRpaCode(language, code) {
  const normalizedLanguage = normalizeLanguage(language);
  if (!normalizedLanguage) {
    throw new Error("Linguagem RPA nao suportada.");
  }
  if (!String(code || "").trim()) {
    throw new Error("Codigo RPA nao informado.");
  }

  const result = await runRpaCommand({
    language: normalizedLanguage,
    code,
    mode: "validate"
  });

  return {
    ...result,
    status: result.exitCode === 0 ? "passed" : "failed",
    message: result.exitCode === 0 ? "Codigo validado com sucesso." : "Falha na validacao do codigo."
  };
}

export async function executeRpaCode(language, code, { rpaFiles = [], rpaFile = null, mode = "run", timeoutMs = DEFAULT_TIMEOUT_MS, onProgress } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  if (!normalizedLanguage) {
    throw new Error("Linguagem RPA nao suportada.");
  }
  if (!String(code || "").trim()) {
    throw new Error("Codigo RPA nao informado.");
  }

  const result = await runRpaCommand({
    language: normalizedLanguage,
    code,
    rpaFiles: rpaFiles.length ? rpaFiles : (rpaFile ? [{ fileName: "input_file.xlsx", fileContent: rpaFile }] : []),
    mode,
    timeoutMs,
    onProgress,
  });

  return {
    ...result,
    status: result.exitCode === 0 ? "success" : "failed",
    message: result.exitCode === 0 ? "Execucao concluida com sucesso." : "Execucao falhou."
  };
}

async function runRpaCommand({ language, code, rpaFiles = [], mode, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress }) {
  if (String(code || "").length > MAX_CODE_CHARS) {
    throw new Error("Codigo RPA excede o limite permitido.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gestao-rpa-data-"));
  const startedAt = new Date().toISOString();

  let primaryFilePath = "";

  for (const file of rpaFiles) {
    if (!file.fileContent || !file.fileContent.includes("base64,")) continue;
    try {
      const base64Data = file.fileContent.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      const filePath = path.join(tempDir, file.fileName || `file_${crypto.randomBytes(4).toString("hex")}`);
      await fs.writeFile(filePath, buffer);
      if (!primaryFilePath) primaryFilePath = filePath;
    } catch (e) {
      console.error(`Erro ao salvar arquivo RPA (${file.fileName}):`, e);
    }
  }

  try {
    const interpreter = getInterpreter(language);
    if (!interpreter) {
      throw new Error(`Interpretador nao encontrado para a linguagem selecionada: ${language}`);
    }

    let commandChain;

    if (mode === "validate") {
      // Validação: usa stdin direto (sem wrapper)
      commandChain = language === "python"
        ? [[interpreter, ["-m", "py_compile", "-"]]]
        : [[interpreter, ["--check"]]];

      const output = await runCommandChain(commandChain, { timeoutMs, cwd: tempDir, stdin: code, onProgress });
      const finishedAt = new Date().toISOString();
      return {
        ...output,
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        language,
      };
    }

    // ── Execução: injeta o código do usuário no wrapper ──
    if (language === "javascript") {
      // Lê o template do wrapper JS
      const wrapperTemplate = await fs.readFile(
        path.join(process.cwd(), "server", "rpaWrapper.js"),
        "utf8"
      );
      // Injeta o código do usuário no lugar do placeholder
      // Usa função no replace para evitar interpretação de $ no código do usuário
      const wrappedCode = wrapperTemplate.replace("// __RPA_USER_CODE_PLACEHOLDER__", () => code);
      const scriptPath = path.join(tempDir, "rpa_script.js");
      await fs.writeFile(scriptPath, wrappedCode, "utf8");

      const args = [scriptPath];
      if (primaryFilePath) args.push(primaryFilePath);
      commandChain = [[interpreter, args]];

    } else {
      // Python: injeta no wrapper Python
      const wrapperTemplate = await fs.readFile(
        path.join(process.cwd(), "server", "rpaWrapperPy.py"),
        "utf8"
      );
      const wrappedCode = wrapperTemplate.replace("# __RPA_USER_CODE_PLACEHOLDER__", () => code);
      const scriptPath = path.join(tempDir, "rpa_script.py");
      await fs.writeFile(scriptPath, wrappedCode, "utf8");

      const args = [scriptPath];
      if (primaryFilePath) args.push(primaryFilePath);
      commandChain = [[interpreter, args]];
    }

    const output = await runCommandChain(commandChain, { timeoutMs, cwd: tempDir, stdin: null, onProgress });
    const finishedAt = new Date().toISOString();
    return {
      ...output,
      startedAt,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      language,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runCommandChain(commandChain, { timeoutMs, cwd, stdin, onProgress }) {
  let lastError = null;
  for (const [command, args] of commandChain) {
    try {
      return await runCommand(command, args, { timeoutMs, cwd, stdin, onProgress });
    } catch (error) {
      if (error?.code === "ENOENT") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw new Error(lastError ? "Interpretador nao encontrado para a linguagem selecionada." : "Falha ao executar comando RPA.");
}

function runCommand(command, args, { timeoutMs, cwd, stdin, onProgress }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let isTimedOut = false;

    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        NODE_PATH: path.join(process.cwd(), "node_modules"),
        RPA_MODE: "local",
        RPA_COMMAND: modeFromArgs(args),
        // Garante que Python não bufferize stdout (logs em tempo real)
        PYTHONUNBUFFERED: "1",
        // Garante display virtual para modo visível no container Linux
        DISPLAY: process.env.DISPLAY || ":99",
      }
    });

    let stdout = "";
    let stderr = "";
    // Buffer parcial para montar linhas completas vindas do script
    let stdoutBuffer = "";
    let stderrBuffer = "";

    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      stdoutBuffer += chunk;

      // Processa linhas completas para emitir progresso em tempo real
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop(); // guarda linha incompleta

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (typeof onProgress !== "function") continue;

        try {
          // Tenta parsear como JSON estruturado (scripts que usam log())
          const parsed = JSON.parse(trimmed);
          onProgress(parsed);
        } catch {
          // Linha de texto puro (print() simples) — converte para evento info
          // Detecta palavras-chave para inferir o nível correto
          const lower = trimmed.toLowerCase();
          const level =
            lower.startsWith("erro") || lower.includes("error") || lower.includes("traceback") ? "error" :
            lower.startsWith("aviso") || lower.includes("warn") ? "warn" :
            lower.includes("sucesso") || lower.includes("success") || lower.includes("resultado") || lower.includes("conclu") ? "success" :
            lower.includes("clicando") || lower.includes("navegando") || lower.includes("preenchendo") || lower.includes("campo") ? "action" :
            lower.includes("registros") || lower.includes("rodada") || lower.includes("record") ? "progress" :
            "info";

          onProgress({
            ts: new Date().toISOString(),
            level,
            message: trimmed,
          });
        }
      }
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      stderrBuffer += chunk;

      // Repassa linhas de stderr como eventos de erro/warn em tempo real
      if (typeof onProgress === "function") {
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Filtra ruídos comuns do Python/Node que não são erros reais
          if (trimmed.startsWith("WARNING:") && trimmed.includes("pip")) continue;
          const level = trimmed.toLowerCase().includes("error") || trimmed.startsWith("Traceback") ? "error" : "warn";
          onProgress({ ts: new Date().toISOString(), level, message: trimmed });
        }
      }
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") return reject(error);
      reject(error);
    });

    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      const finishedAt = Date.now();
      const exitCode = code ?? (signal ? 128 + 15 : 1);

      resolve({
        exitCode: isTimedOut ? 1 : exitCode,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        timedOut: isTimedOut,
        command,
        args,
        durationMs: finishedAt - startedAt
      });
    });
  });
}

function truncateOutput(value) {
  const text = String(value || "");
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...output truncated...`;
}

function normalizeScheduleMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["manual", "hours", "dates"].includes(normalized)) return normalized;
  return "manual";
}

function modeFromArgs(args) {
  return args.includes("--check") || args.includes("py_compile") ? "validate" : "run";
}

function getInterpreter(language) {
  const normalized = String(language || "")
    .trim()
    .toLowerCase();

  const interpreters = {
    python: "python3",
    py: "python3",
    python3: "python3",

    javascript: "node",
    js: "node",
    node: "node",
    nodejs: "node",
  };

  return interpreters[normalized];
}
