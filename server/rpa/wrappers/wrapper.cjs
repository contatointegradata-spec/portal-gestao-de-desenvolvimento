/**
 * Wrapper de execucao RPA — JavaScript (CommonJS)
 *
 * - Instrumenta o Playwright (logs de acao + screenshots ao vivo)
 * - Converte console.* em logs JSON estruturados (lidos pelo servidor)
 * - Expoe o helper global `rpa` (log, progress, screenshot, arquivos de entrada/saida)
 * - Carrega o script do usuario como arquivo separado (numeros de linha preservados)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const USER_SCRIPT = process.env.RPA_USER_SCRIPT;
const HEADLESS = process.env.RPA_HEADLESS !== "0";
const SCREENSHOT_INTERVAL_MS = 700;
const SENSITIVE_RE = /(senha|password|passwd|pwd|token|secret|cpf|cartao|card)/i;

const writeLine = (text) => process.stdout.write(`${text}\n`);

function emit(level, message, extra = {}) {
  writeLine(JSON.stringify({ ts: new Date().toISOString(), level, message: String(message), ...extra }));
}

function formatArgs(args) {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === "object") {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }
    return String(arg);
  }).join(" ");
}

function inferLevel(message) {
  const lower = message.toLowerCase();
  if (lower.includes("erro") || lower.includes("error") || lower.includes("falha")) return "error";
  if (lower.includes("aviso") || lower.includes("warn")) return "warn";
  if (lower.includes("sucesso") || lower.includes("success") || lower.includes("conclu") || lower.includes("resultado")) return "success";
  return "info";
}

let lastScreenshotAt = 0;
async function captureScreenshot(page, label, force = false) {
  const now = Date.now();
  if (!force && now - lastScreenshotAt < SCREENSHOT_INTERVAL_MS) return;
  lastScreenshotAt = now;
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
    writeLine(JSON.stringify({
      ts: new Date().toISOString(),
      level: "screenshot",
      message: label,
      image: `data:image/jpeg;base64,${buffer.toString("base64")}`,
      url: page.url()
    }));
  } catch (_) { /* pagina fechada ou navegando */ }
}

function describeValue(selector, value) {
  const text = String(value ?? "");
  if (SENSITIVE_RE.test(String(selector))) return "••••••";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

// ─── Helper global ────────────────────────────────────────────────────────────
global.rpa = {
  workDir: process.env.RPA_WORKDIR || process.cwd(),
  outputDir: process.env.RPA_OUTPUT_DIR || process.cwd(),
  inputFile: process.env.RPA_INPUT_FILE || "",
  files: JSON.parse(process.env.RPA_FILES || "[]"),
  log: (message, extra) => emit("info", message, extra),
  info: (message, extra) => emit("info", message, extra),
  success: (message, extra) => emit("success", message, extra),
  warn: (message, extra) => emit("warn", message, extra),
  error: (message, extra) => emit("error", message, extra),
  action: (message, extra) => emit("action", message, extra),
  progress: (current, total, message) => emit("progress", message || `Progresso ${current}/${total}`, {
    current, total, percent: total ? Math.round((current / total) * 100) : 0
  }),
  screenshot: (page, label = "Captura") => captureScreenshot(page, label, true),
  saveOutput: (fileName, content) => {
    const target = path.join(global.rpa.outputDir, path.basename(fileName));
    fs.writeFileSync(target, content);
    emit("success", `Arquivo de saida gerado: ${path.basename(fileName)}`);
    return target;
  }
};

// ─── Instrumentacao do Playwright ─────────────────────────────────────────────
function wrapPage(page) {
  if (!page || page.__rpaWrapped) return page;
  page.__rpaWrapped = true;

  const originalGoto = page.goto.bind(page);
  page.goto = async (url, options) => {
    emit("action", `Navegando para ${url}`);
    const response = await originalGoto(url, options);
    await captureScreenshot(page, `Pagina carregada: ${url}`, true);
    return response;
  };

  const originalClick = page.click.bind(page);
  page.click = async (selector, options) => {
    emit("action", `Clique em ${selector}`);
    const result = await originalClick(selector, options);
    await captureScreenshot(page, `Apos clique: ${selector}`);
    return result;
  };

  const originalFill = page.fill.bind(page);
  page.fill = async (selector, value, options) => {
    emit("action", `Preenchendo ${selector}: ${describeValue(selector, value)}`);
    return originalFill(selector, value, options);
  };

  if (typeof page.type === "function") {
    const originalType = page.type.bind(page);
    page.type = async (selector, text, options) => {
      emit("action", `Digitando em ${selector}: ${describeValue(selector, text)}`);
      return originalType(selector, text, options);
    };
  }
  return page;
}

function wrapContext(context) {
  if (!context || context.__rpaWrapped) return context;
  context.__rpaWrapped = true;
  const originalNewPage = context.newPage.bind(context);
  context.newPage = async (...args) => wrapPage(await originalNewPage(...args));
  context.on?.("page", (page) => wrapPage(page));
  return context;
}

function wrapBrowser(browser) {
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => wrapContext(await originalNewContext({ ignoreHTTPSErrors: true, ...options }));
  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (options = {}) => wrapPage(await originalNewPage({ ignoreHTTPSErrors: true, ...options }));
  return browser;
}

const NO_DISPLAY_RE = /XServer|Missing X server|\$DISPLAY|cannot open display/i;

function launchOptions(browserType, options = {}, headless = HEADLESS) {
  const merged = { ...options, headless };
  if (!headless && merged.slowMo === undefined) merged.slowMo = 60;
  if (browserType.name() === "chromium") {
    const base = ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors", "--window-size=1366,900", "--window-position=0,0"];
    merged.args = [...base, ...(options.args || []).filter((arg) => !base.includes(arg))];
  }
  return merged;
}

async function launchWithFallback(launcher, browserType, options) {
  try {
    return await launcher(launchOptions(browserType, options));
  } catch (error) {
    // Sem X server no servidor: em vez de falhar a execucao, reabre em headless.
    if (HEADLESS || !NO_DISPLAY_RE.test(String(error && error.message))) throw error;
    emit("warn", "Display grafico indisponivel no servidor; reabrindo o navegador em modo headless");
    return launcher(launchOptions(browserType, options, true));
  }
}

function wrapBrowserType(browserType) {
  return new Proxy(browserType, {
    get(target, property) {
      if (property === "launch") {
        return async (options = {}) => {
          emit("action", `Abrindo navegador ${target.name()} (${HEADLESS ? "headless" : "visivel"})`);
          const browser = await launchWithFallback((opts) => target.launch(opts), target, options);
          return wrapBrowser(browser);
        };
      }
      if (property === "launchPersistentContext") {
        return async (userDataDir, options = {}) => wrapContext(await launchWithFallback((opts) => target.launchPersistentContext(userDataDir, opts), target, options));
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

const originalLoad = Module._load;
const wrappedModules = new Map();
Module._load = function patchedLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (request === "playwright" || request === "playwright-core") {
    if (!wrappedModules.has(request)) {
      wrappedModules.set(request, new Proxy(loaded, {
        get(target, property) {
          if (["chromium", "firefox", "webkit"].includes(property)) return wrapBrowserType(target[property]);
          return target[property];
        }
      }));
    }
    return wrappedModules.get(request);
  }
  return loaded;
};

// ─── console.* → logs estruturados ────────────────────────────────────────────
console.log = (...args) => {
  const message = formatArgs(args);
  try {
    const parsed = JSON.parse(message);
    if (parsed && parsed.level && parsed.message !== undefined) return writeLine(message);
  } catch (_) { /* texto comum */ }
  emit(inferLevel(message), message);
};
console.info = (...args) => emit("info", formatArgs(args));
console.warn = (...args) => emit("warn", formatArgs(args));
console.error = (...args) => emit("error", formatArgs(args));

process.on("unhandledRejection", (reason) => {
  emit("error", `Erro nao tratado: ${reason && reason.stack ? reason.stack : reason}`);
  process.exitCode = 1;
});

// ─── Execucao do script do usuario ────────────────────────────────────────────
(async () => {
  try {
    const exported = USER_SCRIPT.endsWith(".mjs")
      ? await import(require("url").pathToFileURL(USER_SCRIPT).href)
      : require(USER_SCRIPT);
    const entry = typeof exported === "function" ? exported : typeof exported?.default === "function" ? exported.default : null;
    if (entry) await entry(global.rpa);
  } catch (error) {
    emit("error", error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
})();
