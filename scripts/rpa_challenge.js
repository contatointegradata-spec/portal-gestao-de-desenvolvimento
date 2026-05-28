/**
 * RPA Challenge - Playwright JS
 * Emite logs JSON + screenshots base64 em tempo real via stdout.
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { chromium } = require("playwright");

const CONFIG = {
  url: "https://rpachallenge.com/",
  timeout: 60_000,
  fieldTimeout: 10_000,
  retryAttempts: 3,
  retryDelayMs: 400,
  headless: !process.env.DISPLAY,
  slowMo: 80,
};

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(level, message, data = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, message, ...data }) + "\n");
}

async function screenshot(page, label) {
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
    const b64 = buf.toString("base64");
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: "screenshot",
      message: label,
      image: `data:image/jpeg;base64,${b64}`,
      url: page.url(),
    }) + "\n");
  } catch (e) {
    log("warn", `Screenshot falhou: ${e.message}`);
  }
}

// ─── Excel ────────────────────────────────────────────────────────────────────
function loadExcel(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }).map(row => {
    const r = {};
    for (const k of Object.keys(row)) r[k.trim()] = String(row[k] ?? "").trim();
    return r;
  });
  if (!rows.length) throw new Error("Planilha vazia.");
  return rows;
}

// ─── Preenchimento ────────────────────────────────────────────────────────────
async function fillField(page, labelName, value, attempt = 1) {
  const selector = `xpath=//div[label[normalize-space()='${labelName}']]/input`;
  try {
    const loc = page.locator(selector);
    await loc.waitFor({ state: "visible", timeout: CONFIG.fieldTimeout });
    await loc.click();
    await loc.fill("");
    await loc.type(String(value ?? ""), { delay: 25 });
    log("action", `⌨ ${labelName}: ${value}`, { field: labelName, value });
  } catch (err) {
    if (attempt < CONFIG.retryAttempts) {
      log("warn", `Retry ${attempt} — campo '${labelName}'`);
      await page.waitForTimeout(CONFIG.retryDelayMs);
      return fillField(page, labelName, value, attempt + 1);
    }
    throw new Error(`Campo "${labelName}" não encontrado: ${err.message}`);
  }
}

// ─── Principal ────────────────────────────────────────────────────────────────
async function runChallenge(excelPath) {
  log("info", "🚀 Iniciando RPA Challenge", { file: excelPath });

  let rows;
  try {
    rows = loadExcel(excelPath);
    log("info", `📊 Dados carregados: ${rows.length} registros`, { total: rows.length });
  } catch (err) {
    log("error", err.message);
    process.exit(1);
  }

  const display = process.env.DISPLAY || "";
  const useHeadless = !display;
  log("info", `🖥 Modo: ${useHeadless ? "headless" : `visível (DISPLAY=${display})`}`, { headless: useHeadless });

  let browser;
  try {
    log("action", "🌐 Abrindo navegador Chromium...");
    browser = await chromium.launch({
      headless: useHeadless,
      slowMo: CONFIG.slowMo,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
             "--window-size=1280,900", "--ignore-certificate-errors"],
    });
  } catch (err) {
    log("error", `Falha ao iniciar navegador: ${err.message}`);
    process.exit(1);
  }

  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // ── Navega ──
    log("action", `🔗 Navegando para ${CONFIG.url}`);
    await page.goto(CONFIG.url, { waitUntil: "domcontentloaded", timeout: CONFIG.timeout });
    log("info", "✅ Página carregada");
    await screenshot(page, "Página inicial carregada");

    // ── Start ──
    log("action", "🖱 Clicando em Start...");
    await page.click("button:has-text('Start')");
    log("info", "▶ Desafio iniciado!");
    await screenshot(page, "Desafio iniciado — primeiro formulário");

    // ── Preenche ──
    const total = rows.length;
    for (let i = 0; i < total; i++) {
      const row = rows[i];
      log("progress", `📝 Registro ${i+1}/${total}`, { current: i+1, total, percent: Math.round(((i+1)/total)*100) });

      await fillField(page, "First Name",      row["First Name"]);
      await fillField(page, "Last Name",       row["Last Name"]);
      await fillField(page, "Company Name",    row["Company Name"]);
      await fillField(page, "Role in Company", row["Role in Company"]);
      await fillField(page, "Address",         row["Address"]);
      await fillField(page, "Email",           row["Email"]);
      await fillField(page, "Phone Number",    row["Phone Number"]);

      await screenshot(page, `Formulário ${i+1} preenchido`);

      log("action", `🖱 Submit — registro ${i+1}`);
      await page.click("input[type='submit']");
    }

    // ── Resultado ──
    log("info", "⏳ Aguardando resultado...");
    let resultText = "";
    try {
      await page.waitForSelector(".message2", { timeout: 8_000 });
      resultText = (await page.innerText(".message2")).trim();
      await screenshot(page, `Resultado: ${resultText}`);
      log("success", `🏆 ${resultText}`, { result: resultText });
    } catch {
      log("warn", "Resultado não encontrado.");
    }

    if (!useHeadless) await page.waitForTimeout(3_000);
    log("success", "✅ RPA Challenge concluído!", { result: resultText });

  } catch (err) {
    log("error", `❌ Erro: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
    log("action", "🔒 Navegador encerrado.");
  }
}

runChallenge(process.argv[2] || "");
