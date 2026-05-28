/**
 * RPA Wrapper — JavaScript
 *
 * Este arquivo é gerado dinamicamente pelo motor e executado no lugar do código
 * do usuário. Ele injeta um proxy do Playwright que:
 *   1. Captura screenshots automaticamente após cada navegação e clique
 *   2. Emite logs JSON estruturados para stdout (capturados pelo servidor via SSE)
 *   3. Executa o código do usuário sem modificação
 *
 * O código do usuário é injetado no final deste arquivo via __USER_CODE__.
 */

const { chromium: _realChromium, firefox: _realFirefox, webkit: _realWebkit } = require("playwright");

// ─── Logger estruturado ───────────────────────────────────────────────────────
function _rpaLog(level, message, extra = {}) {
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...extra,
  }) + "\n");
}

async function _rpaScreenshot(page, label) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 65, fullPage: false });
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: "screenshot",
      message: label,
      image: "data:image/jpeg;base64," + buf.toString("base64"),
      url: page.url(),
    }) + "\n");
  } catch (_) {}
}

// ─── Proxy de Page ────────────────────────────────────────────────────────────
function _wrapPage(page) {
  // Intercepta goto
  const _origGoto = page.goto.bind(page);
  page.goto = async (url, opts) => {
    _rpaLog("action", `🔗 Navegando para: ${url}`);
    const result = await _origGoto(url, opts);
    await _rpaScreenshot(page, `Página carregada: ${url}`);
    return result;
  };

  // Intercepta click
  const _origClick = page.click.bind(page);
  page.click = async (selector, opts) => {
    _rpaLog("action", `🖱 Clique: ${selector}`);
    const result = await _origClick(selector, opts);
    await _rpaScreenshot(page, `Após clique: ${selector}`);
    return result;
  };

  // Intercepta fill
  const _origFill = page.fill.bind(page);
  page.fill = async (selector, value, opts) => {
    _rpaLog("action", `⌨ Preenchendo campo: ${value}`);
    return _origFill(selector, value, opts);
  };

  // Intercepta type
  const _origType = page.type?.bind(page);
  if (_origType) {
    page.type = async (selector, text, opts) => {
      _rpaLog("action", `⌨ Digitando: ${text}`);
      return _origType(selector, text, opts);
    };
  }

  // Intercepta waitForSelector
  const _origWaitForSelector = page.waitForSelector.bind(page);
  page.waitForSelector = async (selector, opts) => {
    _rpaLog("info", `⏳ Aguardando elemento: ${selector}`);
    return _origWaitForSelector(selector, opts);
  };

  return page;
}

// ─── Proxy de BrowserContext ──────────────────────────────────────────────────
function _wrapContext(context) {
  const _origNewPage = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await _origNewPage(...args);
    return _wrapPage(page);
  };
  return context;
}

// ─── Proxy de Browser ─────────────────────────────────────────────────────────
function _wrapBrowser(browser) {
  const _origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await _origNewContext(...args);
    return _wrapContext(ctx);
  };

  const _origNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await _origNewPage(...args);
    return _wrapPage(page);
  };

  return browser;
}

// ─── Proxy de BrowserType (chromium / firefox / webkit) ──────────────────────
function _wrapBrowserType(browserType) {
  return new Proxy(browserType, {
    get(target, prop) {
      if (prop === "launch") {
        return async (opts = {}) => {
          // Força headless=false se DISPLAY estiver disponível (modo visível via Xvfb)
          const display = process.env.DISPLAY || "";
          const useHeadless = !display;
          const mergedOpts = {
            ...opts,
            headless: useHeadless,
            slowMo: opts.slowMo ?? 80,
            args: [
              "--no-sandbox",
              "--disable-dev-shm-usage",
              "--disable-gpu",
              "--window-size=1280,900",
              "--ignore-certificate-errors",
              ...(opts.args || []).filter(a =>
                !a.startsWith("--no-sandbox") &&
                !a.startsWith("--disable-dev-shm-usage") &&
                !a.startsWith("--disable-gpu")
              ),
            ],
          };
          _rpaLog("action", `🌐 Abrindo navegador (${useHeadless ? "headless" : "visível DISPLAY=" + display})`);
          const browser = await target.launch(mergedOpts);
          _rpaLog("info", "✅ Navegador aberto");
          return _wrapBrowser(browser);
        };
      }
      if (prop === "launchPersistentContext") {
        return async (userDataDir, opts = {}) => {
          const ctx = await target.launchPersistentContext(userDataDir, opts);
          return _wrapContext(ctx);
        };
      }
      return typeof target[prop] === "function" ? target[prop].bind(target) : target[prop];
    }
  });
}

// ─── Substitui o módulo playwright globalmente ────────────────────────────────
// O require() do código do usuário vai pegar este proxy em vez do playwright real
const Module = require("module");
const _origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "playwright" || request === "playwright-core") {
    return {
      chromium: _wrapBrowserType(_realChromium),
      firefox:  _wrapBrowserType(_realFirefox),
      webkit:   _wrapBrowserType(_realWebkit),
    };
  }
  return _origLoad.apply(this, arguments);
};

// ─── Intercepta console.log do usuário ───────────────────────────────────────
const _origConsoleLog = console.log;
console.log = (...args) => {
  const message = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  // Evita double-emit se já for JSON estruturado
  try {
    const parsed = JSON.parse(message);
    if (parsed.level && parsed.message) {
      process.stdout.write(message + "\n");
      return;
    }
  } catch (_) {}

  const lower = message.toLowerCase();
  const level =
    lower.includes("erro") || lower.includes("error") ? "error" :
    lower.includes("resultado") || lower.includes("success") || lower.includes("sucesso") || lower.includes("100%") ? "success" :
    lower.includes("registros") || lower.includes("carregados") ? "progress" :
    lower.includes("clicando") || lower.includes("navegando") || lower.includes("preenchendo") ? "action" :
    "info";

  _rpaLog(level, message);
};

console.error = (...args) => {
  const message = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  _rpaLog("error", message);
};

console.warn = (...args) => {
  const message = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  _rpaLog("warn", message);
};

// ─── Código do usuário (injetado pelo motor) ──────────────────────────────────
// __RPA_USER_CODE_PLACEHOLDER__
