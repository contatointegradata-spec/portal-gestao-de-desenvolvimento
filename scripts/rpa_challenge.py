"""
RPA Challenge - Automação com Playwright (Python)

Emite logs JSON estruturados + screenshots base64 em tempo real via stdout.
O servidor Node.js captura e repassa via SSE para a UI exibir como "browser ao vivo".
"""

import sys
import os
import json
import base64
import time
import tempfile
from datetime import datetime, timezone

import pandas as pd
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

CONFIG = {
    "url": "https://rpachallenge.com/",
    "timeout": 60_000,
    "field_timeout": 10_000,
    "retry_attempts": 3,
    "retry_delay_ms": 400,
    # headless=False + DISPLAY=:99 = navegador visível no Xvfb
    "headless": os.environ.get("DISPLAY", "") == "",
    "slow_mo": 80,
    # Captura screenshot após cada ação importante
    "screenshot_on_action": True,
}

# ─── Logger ────────────────────────────────────────────────────────────────────
def log(level: str, message: str, **data):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "message": message, **data}
    print(json.dumps(entry, ensure_ascii=False), flush=True)

def screenshot(page, label: str):
    """Captura screenshot da página e emite como evento 'screenshot' no JSON."""
    if not CONFIG["screenshot_on_action"]:
        return
    try:
        img_bytes = page.screenshot(type="jpeg", quality=70, full_page=False)
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": "screenshot",
            "message": label,
            "image": f"data:image/jpeg;base64,{b64}",
            "url": page.url,
        }
        print(json.dumps(entry, ensure_ascii=False), flush=True)
    except Exception as e:
        log("warn", f"Screenshot falhou: {e}")

# ─── Excel ─────────────────────────────────────────────────────────────────────
def load_excel(file_path: str) -> list:
    if not file_path or not os.path.exists(file_path):
        raise FileNotFoundError(f"Arquivo Excel não encontrado: {file_path}")
    df = pd.read_excel(file_path)
    df.columns = [str(c).strip() for c in df.columns]
    if df.empty:
        raise ValueError("Planilha vazia ou sem dados válidos.")
    return [{k: str(v).strip() if pd.notna(v) else "" for k, v in row.items()} for _, row in df.iterrows()]

# ─── Preenchimento ─────────────────────────────────────────────────────────────
def fill_field(page, label_name: str, value: str, attempt: int = 1):
    selector = f"xpath=//div[label[normalize-space()='{label_name}']]/input"
    try:
        locator = page.locator(selector)
        locator.wait_for(state="visible", timeout=CONFIG["field_timeout"])
        locator.click()
        locator.fill("")
        locator.type(str(value), delay=25)
        log("action", f"⌨ {label_name}: {value}", field=label_name, value=value)
    except PlaywrightTimeout as err:
        if attempt < CONFIG["retry_attempts"]:
            log("warn", f"Retry {attempt} — campo '{label_name}'")
            time.sleep(CONFIG["retry_delay_ms"] / 1000)
            return fill_field(page, label_name, value, attempt + 1)
        raise RuntimeError(f'Campo "{label_name}" não encontrado: {err}')

# ─── Principal ─────────────────────────────────────────────────────────────────
def run_challenge(excel_path: str):
    log("info", "🚀 Iniciando RPA Challenge", file=excel_path)

    try:
        rows = load_excel(excel_path)
        log("info", f"📊 Dados carregados: {len(rows)} registros", total=len(rows))
    except Exception as err:
        log("error", str(err))
        sys.exit(1)

    display = os.environ.get("DISPLAY", "")
    use_headless = display == ""
    log("info", f"🖥 Modo: {'headless' if use_headless else f'visível (DISPLAY={display})'}", headless=use_headless)

    try:
        with sync_playwright() as p:
            log("action", "🌐 Abrindo navegador Chromium...")
            browser = p.chromium.launch(
                headless=use_headless,
                slow_mo=CONFIG["slow_mo"],
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                      "--window-size=1280,900", "--ignore-certificate-errors"],
            )
            context = browser.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 900})
            page = context.new_page()

            # ── Navega ──
            log("action", f"🔗 Navegando para {CONFIG['url']}")
            page.goto(CONFIG["url"], wait_until="domcontentloaded", timeout=CONFIG["timeout"])
            log("info", "✅ Página carregada")
            screenshot(page, "Página inicial carregada")

            # ── Start ──
            log("action", "🖱 Clicando em Start...")
            page.click("button:has-text('Start')")
            log("info", "▶ Desafio iniciado!")
            screenshot(page, "Desafio iniciado — primeiro formulário")

            # ── Preenche registros ──
            total = len(rows)
            for i, row in enumerate(rows):
                log("progress", f"📝 Registro {i+1}/{total}",
                    current=i+1, total=total, percent=round(((i+1)/total)*100))

                fill_field(page, "First Name",      row.get("First Name", ""))
                fill_field(page, "Last Name",       row.get("Last Name", ""))
                fill_field(page, "Company Name",    row.get("Company Name", ""))
                fill_field(page, "Role in Company", row.get("Role in Company", ""))
                fill_field(page, "Address",         row.get("Address", ""))
                fill_field(page, "Email",           row.get("Email", ""))
                fill_field(page, "Phone Number",    row.get("Phone Number", ""))

                # Screenshot após preencher (mostra formulário preenchido)
                screenshot(page, f"Formulário {i+1} preenchido")

                log("action", f"🖱 Submit — registro {i+1}")
                page.click("input[type='submit']")

            # ── Resultado ──
            log("info", "⏳ Aguardando resultado...")
            result_text = ""
            try:
                page.wait_for_selector(".message2", timeout=8_000)
                result_text = page.inner_text(".message2").strip()
                screenshot(page, f"Resultado final: {result_text}")
                log("success", f"🏆 {result_text}", result=result_text)
            except PlaywrightTimeout:
                log("warn", "Resultado não encontrado na página.")

            if not use_headless:
                page.wait_for_timeout(3_000)

            browser.close()
            log("success", "✅ RPA Challenge concluído!", result=result_text)

    except Exception as err:
        log("error", f"❌ Erro: {err}")
        sys.exit(1)

if __name__ == "__main__":
    run_challenge(sys.argv[1] if len(sys.argv) > 1 else "")
