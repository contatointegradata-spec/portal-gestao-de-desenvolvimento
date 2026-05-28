"""
RPA Wrapper — Python

Injeta instrumentação no Playwright antes de executar o código do usuário.
Captura screenshots automaticamente e emite logs JSON estruturados.
O código do usuário é injetado no lugar de __USER_CODE__.
"""

import sys
import os
import json
import base64
from datetime import datetime, timezone
from unittest.mock import patch

# ─── Logger ────────────────────────────────────────────────────────────────────
def _rpa_log(level, message, **extra):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "message": message, **extra}
    print(json.dumps(entry, ensure_ascii=False), flush=True)

def _rpa_screenshot(page, label):
    try:
        img_bytes = page.screenshot(type="jpeg", quality=65, full_page=False)
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": "screenshot",
            "message": label,
            "image": f"data:image/jpeg;base64,{b64}",
            "url": page.url,
        }
        print(json.dumps(entry, ensure_ascii=False), flush=True)
    except Exception:
        pass

# ─── Proxy de Page ─────────────────────────────────────────────────────────────
class _PageProxy:
    def __init__(self, real_page):
        object.__setattr__(self, "_page", real_page)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_page"), name)

    def goto(self, url, **kwargs):
        page = object.__getattribute__(self, "_page")
        _rpa_log("action", f"🔗 Navegando para: {url}")
        result = page.goto(url, **kwargs)
        _rpa_screenshot(page, f"Página carregada: {url}")
        return result

    def click(self, selector, **kwargs):
        page = object.__getattribute__(self, "_page")
        _rpa_log("action", f"🖱 Clique: {selector}")
        result = page.click(selector, **kwargs)
        _rpa_screenshot(page, f"Após clique: {selector}")
        return result

    def fill(self, selector, value, **kwargs):
        page = object.__getattribute__(self, "_page")
        _rpa_log("action", f"⌨ Preenchendo: {value}")
        return page.fill(selector, value, **kwargs)

    def type(self, selector, text, **kwargs):
        page = object.__getattribute__(self, "_page")
        _rpa_log("action", f"⌨ Digitando: {text}")
        return page.type(selector, text, **kwargs)

    def wait_for_selector(self, selector, **kwargs):
        page = object.__getattribute__(self, "_page")
        _rpa_log("info", f"⏳ Aguardando: {selector}")
        return page.wait_for_selector(selector, **kwargs)

    def inner_text(self, selector, **kwargs):
        page = object.__getattribute__(self, "_page")
        return page.inner_text(selector, **kwargs)

    def screenshot(self, **kwargs):
        page = object.__getattribute__(self, "_page")
        return page.screenshot(**kwargs)

    def wait_for_timeout(self, timeout):
        page = object.__getattribute__(self, "_page")
        return page.wait_for_timeout(timeout)

    @property
    def url(self):
        return object.__getattribute__(self, "_page").url

    def locator(self, selector, **kwargs):
        page = object.__getattribute__(self, "_page")
        return page.locator(selector, **kwargs)

# ─── Proxy de BrowserContext ───────────────────────────────────────────────────
class _ContextProxy:
    def __init__(self, real_ctx):
        object.__setattr__(self, "_ctx", real_ctx)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_ctx"), name)

    def new_page(self):
        ctx = object.__getattribute__(self, "_ctx")
        return _PageProxy(ctx.new_page())

    def close(self):
        object.__getattribute__(self, "_ctx").close()

# ─── Proxy de Browser ──────────────────────────────────────────────────────────
class _BrowserProxy:
    def __init__(self, real_browser):
        object.__setattr__(self, "_browser", real_browser)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_browser"), name)

    def new_context(self, **kwargs):
        browser = object.__getattribute__(self, "_browser")
        return _ContextProxy(browser.new_context(**kwargs))

    def new_page(self):
        browser = object.__getattribute__(self, "_browser")
        return _PageProxy(browser.new_page())

    def close(self):
        object.__getattribute__(self, "_browser").close()

# ─── Proxy de BrowserType ──────────────────────────────────────────────────────
class _BrowserTypeProxy:
    def __init__(self, real_bt):
        object.__setattr__(self, "_bt", real_bt)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_bt"), name)

    def launch(self, **kwargs):
        bt = object.__getattribute__(self, "_bt")
        display = os.environ.get("DISPLAY", "")
        use_headless = display == ""
        kwargs["headless"] = use_headless
        kwargs.setdefault("slow_mo", 80)
        base_args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                     "--window-size=1280,900", "--ignore-certificate-errors"]
        user_args = [a for a in kwargs.get("args", [])
                     if not any(a.startswith(x) for x in ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])]
        kwargs["args"] = base_args + user_args
        _rpa_log("action", f"🌐 Abrindo navegador ({'headless' if use_headless else 'visível DISPLAY=' + display})")
        browser = bt.launch(**kwargs)
        _rpa_log("info", "✅ Navegador aberto")
        return _BrowserProxy(browser)

# ─── Proxy de Playwright ───────────────────────────────────────────────────────
class _PlaywrightProxy:
    def __init__(self, real_pw):
        object.__setattr__(self, "_pw", real_pw)

    def __getattr__(self, name):
        val = getattr(object.__getattribute__(self, "_pw"), name)
        # Envolve chromium/firefox/webkit
        if name in ("chromium", "firefox", "webkit"):
            return _BrowserTypeProxy(val)
        return val

    def __enter__(self):
        object.__getattribute__(self, "_pw").__enter__()
        return self

    def __exit__(self, *args):
        return object.__getattribute__(self, "_pw").__exit__(*args)

    def start(self):
        object.__getattribute__(self, "_pw").start()
        return self

    def stop(self):
        object.__getattribute__(self, "_pw").stop()

# ─── Intercepta sync_playwright e async_playwright ────────────────────────────
import playwright.sync_api as _pw_sync
import playwright.async_api as _pw_async

_orig_sync_playwright = _pw_sync.sync_playwright
_orig_async_playwright = _pw_async.async_playwright

class _SyncPlaywrightContextManager:
    def __init__(self):
        self._cm = _orig_sync_playwright()
    def __enter__(self):
        real = self._cm.__enter__()
        return _PlaywrightProxy(real)
    def __exit__(self, *args):
        return self._cm.__exit__(*args)

def _patched_sync_playwright():
    return _SyncPlaywrightContextManager()

_pw_sync.sync_playwright = _patched_sync_playwright

# ─── Intercepta print() do usuário ────────────────────────────────────────────
import builtins
_orig_print = builtins.print

def _rpa_print(*args, **kwargs):
    message = " ".join(str(a) for a in args)
    # Evita double-emit se já for JSON estruturado
    try:
        parsed = json.loads(message)
        if isinstance(parsed, dict) and "level" in parsed and "message" in parsed:
            _orig_print(message, flush=True)
            return
    except Exception:
        pass

    lower = message.lower()
    level = (
        "error"    if ("erro" in lower or "error" in lower) else
        "success"  if ("resultado" in lower or "success" in lower or "sucesso" in lower or "100%" in lower) else
        "progress" if ("registros" in lower or "carregados" in lower or "rodada" in lower) else
        "action"   if ("clicando" in lower or "navegando" in lower or "preenchendo" in lower) else
        "info"
    )
    _rpa_log(level, message)

builtins.print = _rpa_print

# ─── Código do usuário (injetado pelo motor) ───────────────────────────────────
# __RPA_USER_CODE_PLACEHOLDER__
