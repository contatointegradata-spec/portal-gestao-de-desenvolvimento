import { spawnSync } from "node:child_process";
import { config } from "../config.js";

export const SUPPORTED_LANGUAGES = ["python", "javascript"];

export function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (["js", "javascript", "node", "nodejs"].includes(language)) return "javascript";
  if (["py", "python", "python3"].includes(language)) return "python";
  return "";
}

let pythonCache = null;

/**
 * Descobre o executavel do Python: PYTHON_BIN (se definido) ou tenta os
 * candidatos da plataforma (Windows nao possui "python3" por padrao).
 */
export function resolvePython() {
  if (pythonCache) return pythonCache;
  const candidates = config.rpa.pythonBin
    ? [[config.rpa.pythonBin, []]]
    : process.platform === "win32"
      ? [["python", []], ["py", ["-3"]], ["python3", []]]
      : [["python3", []], ["python", []]];

  for (const [command, prefixArgs] of candidates) {
    const probe = spawnSync(command, [...prefixArgs, "--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    if (probe.status === 0) {
      const version = `${probe.stdout || ""}${probe.stderr || ""}`.trim();
      if (/Python 3\./.test(version)) {
        pythonCache = { command, prefixArgs, version };
        return pythonCache;
      }
    }
  }
  return null;
}

export function resolveInterpreter(language) {
  if (language === "javascript") return { command: process.execPath, prefixArgs: [], version: `Node ${process.version}` };
  if (language === "python") return resolvePython();
  return null;
}

let diagnosticsCache = null;

/** Diagnostico do ambiente de execucao (exibido na documentacao). Cache de 5 minutos. */
export function runtimeDiagnostics() {
  if (diagnosticsCache && diagnosticsCache.expiresAt > Date.now()) return diagnosticsCache.value;
  const python = resolvePython();
  const pythonModules = {};
  if (python) {
    for (const moduleName of ["pandas", "openpyxl", "playwright", "requests"]) {
      const check = spawnSync(python.command, [...python.prefixArgs, "-c", `import ${moduleName}`], { windowsHide: true, timeout: 20000 });
      pythonModules[moduleName] = check.status === 0;
    }
  }
  const nodeModules = {};
  for (const moduleName of ["playwright", "xlsx"]) {
    try {
      import.meta.resolve?.(moduleName);
      nodeModules[moduleName] = true;
    } catch {
      nodeModules[moduleName] = false;
    }
  }
  const value = {
    platform: process.platform,
    node: process.version,
    python: python ? { command: [python.command, ...python.prefixArgs].join(" "), version: python.version } : null,
    pythonModules,
    nodeModules
  };
  diagnosticsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
  return value;
}
