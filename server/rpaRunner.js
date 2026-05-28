import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const EXECUTION_TIMEOUT_MS = 15_000;

export async function validateRpaCode({ language, code }) {
  const runtime = getRuntime(language);
  if (!runtime) {
    return { ok: false, error: "Linguagem invalida." };
  }

  const extension = runtime.extension;
  const filePath = path.join(os.tmpdir(), `gestao-dev-unimed-${crypto.randomUUID()}.${extension}`);

  try {
    await fs.writeFile(filePath, code, "utf8");
    const result = await runCommand(runtime.validateCommand(filePath), EXECUTION_TIMEOUT_MS);
    return {
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.code === 0 ? "" : result.stderr || "Codigo invalido."
    };
  } finally {
    await safeUnlink(filePath);
  }
}

export async function executeRpaCode({ language, code }) {
  const runtime = getRuntime(language);
  if (!runtime) {
    return { ok: false, error: "Linguagem invalida." };
  }

  const extension = runtime.extension;
  const filePath = path.join(os.tmpdir(), `gestao-dev-unimed-${crypto.randomUUID()}.${extension}`);

  try {
    await fs.writeFile(filePath, code, "utf8");
    const result = await runCommand(runtime.executeCommand(filePath), EXECUTION_TIMEOUT_MS);
    return {
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.code === 0 ? "" : result.stderr || "Falha ao executar o RPA.",
      exitCode: result.code
    };
  } finally {
    await safeUnlink(filePath);
  }
}

function getRuntime(language) {
  if (language === "javascript") {
    return {
      extension: "js",
      validateCommand: (filePath) => [process.execPath, ["--check", filePath]],
      executeCommand: (filePath) => [process.execPath, [filePath]]
    };
  }

  if (language === "python") {
    return {
      extension: "py",
      validateCommand: (filePath) => ["python3", ["-m", "py_compile", filePath]],
      executeCommand: (filePath) => ["python3", [filePath]]
    };
  }

  return null;
}

function runCommand([command, args], timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGTERM");
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\nProcesso excedeu o tempo limite de ${timeoutMs}ms.`.trim()
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim()
      });
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // noop
  }
}
