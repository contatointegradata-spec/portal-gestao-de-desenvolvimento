"""
Wrapper de execucao RPA — Python

- Instrumenta o Playwright (sync) com logs de acao e screenshots ao vivo
- Converte print() em logs JSON estruturados (lidos pelo servidor)
- Expoe o helper global `rpa` (log, progress, screenshot, arquivos de entrada/saida)
- Executa o script do usuario com runpy (numeros de linha e __main__ preservados)
"""

import base64
import builtins
import json
import os
import re
import runpy
import sys
import time
import traceback
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except Exception:
    pass

USER_SCRIPT = os.environ.get("RPA_USER_SCRIPT", "")
HEADLESS = os.environ.get("RPA_HEADLESS", "1") != "0"
SCREENSHOT_INTERVAL = 0.7
SENSITIVE_RE = re.compile(r"(senha|password|passwd|pwd|token|secret|cpf|cartao|card)", re.IGNORECASE)

_original_print = builtins.print
_stdout = sys.stdout


def _write_line(text):
    _stdout.write(text + "\n")
    _stdout.flush()


def _emit(level, message, **extra):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "message": str(message)}
    entry.update(extra)
    _write_line(json.dumps(entry, ensure_ascii=False, default=str))


def _infer_level(message):
    lower = message.lower()
    if "erro" in lower or "error" in lower or "falha" in lower:
        return "error"
    if "aviso" in lower or "warn" in lower:
        return "warn"
    if "sucesso" in lower or "success" in lower or "conclu" in lower or "resultado" in lower:
        return "success"
    return "info"


_last_screenshot = [0.0]


def _capture(page, label, force=False):
    now = time.time()
    if not force and now - _last_screenshot[0] < SCREENSHOT_INTERVAL:
        return
    _last_screenshot[0] = now
    try:
        image = page.screenshot(type="jpeg", quality=60, full_page=False)
        _write_line(json.dumps({
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": "screenshot",
            "message": label,
            "image": "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii"),
            "url": page.url,
        }, ensure_ascii=False))
    except Exception:
        pass


def _describe(selector, value):
    text = str(value if value is not None else "")
    if SENSITIVE_RE.search(str(selector)):
        return "••••••"
    return text if len(text) <= 40 else text[:40] + "…"


# ─── Helper global ────────────────────────────────────────────────────────────
class _RpaHelper:
    work_dir = os.environ.get("RPA_WORKDIR", os.getcwd())
    output_dir = os.environ.get("RPA_OUTPUT_DIR", os.getcwd())
    input_file = os.environ.get("RPA_INPUT_FILE", "")
    files = json.loads(os.environ.get("RPA_FILES", "[]"))

    def log(self, message, **extra):
        _emit("info", message, **extra)

    info = log

    def success(self, message, **extra):
        _emit("success", message, **extra)

    def warn(self, message, **extra):
        _emit("warn", message, **extra)

    def error(self, message, **extra):
        _emit("error", message, **extra)

    def action(self, message, **extra):
        _emit("action", message, **extra)

    def progress(self, current, total, message=None):
        percent = round((current / total) * 100) if total else 0
        _emit("progress", message or f"Progresso {current}/{total}", current=current, total=total, percent=percent)

    def screenshot(self, page, label="Captura"):
        _capture(page, label, force=True)

    def save_output(self, file_name, content):
        target = os.path.join(self.output_dir, os.path.basename(file_name))
        mode = "wb" if isinstance(content, (bytes, bytearray)) else "w"
        with open(target, mode, **({} if mode == "wb" else {"encoding": "utf-8"})) as handle:
            handle.write(content)
        _emit("success", f"Arquivo de saida gerado: {os.path.basename(file_name)}")
        return target


rpa = _RpaHelper()
builtins.rpa = rpa


# ─── print() → logs estruturados ──────────────────────────────────────────────
def _rpa_print(*args, sep=" ", end="\n", file=None, flush=False):
    if file is not None and file not in (sys.stdout, _stdout):
        return _original_print(*args, sep=sep, end=end, file=file, flush=flush)
    message = sep.join(str(arg) for arg in args)
    try:
        parsed = json.loads(message)
        if isinstance(parsed, dict) and "level" in parsed and "message" in parsed:
            _write_line(message)
            return
    except Exception:
        pass
    for line in message.splitlines() or [""]:
        if line.strip():
            _emit(_infer_level(line), line)


builtins.print = _rpa_print


# ─── Instrumentacao do Playwright (sync) ──────────────────────────────────────
class _PageProxy:
    def __init__(self, page):
        object.__setattr__(self, "_page", page)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_page"), name)

    def __setattr__(self, name, value):
        setattr(object.__getattribute__(self, "_page"), name, value)

    def goto(self, url, **kwargs):
        page = object.__getattribute__(self, "_page")
        _emit("action", f"Navegando para {url}")
        response = page.goto(url, **kwargs)
        _capture(page, f"Pagina carregada: {url}", force=True)
        return response

    def click(self, selector, **kwargs):
        page = object.__getattribute__(self, "_page")
        _emit("action", f"Clique em {selector}")
        result = page.click(selector, **kwargs)
        _capture(page, f"Apos clique: {selector}")
        return result

    def fill(self, selector, value, **kwargs):
        page = object.__getattribute__(self, "_page")
        _emit("action", f"Preenchendo {selector}: {_describe(selector, value)}")
        return page.fill(selector, value, **kwargs)

    def type(self, selector, text, **kwargs):
        page = object.__getattribute__(self, "_page")
        _emit("action", f"Digitando em {selector}: {_describe(selector, text)}")
        return page.type(selector, text, **kwargs)


class _ContextProxy:
    def __init__(self, context):
        object.__setattr__(self, "_ctx", context)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_ctx"), name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return object.__getattribute__(self, "_ctx").__exit__(*args)

    def new_page(self, **kwargs):
        return _PageProxy(object.__getattribute__(self, "_ctx").new_page(**kwargs))


class _BrowserProxy:
    def __init__(self, browser):
        object.__setattr__(self, "_browser", browser)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_browser"), name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return object.__getattribute__(self, "_browser").__exit__(*args)

    def new_context(self, **kwargs):
        kwargs.setdefault("ignore_https_errors", True)
        return _ContextProxy(object.__getattribute__(self, "_browser").new_context(**kwargs))

    def new_page(self, **kwargs):
        kwargs.setdefault("ignore_https_errors", True)
        return _PageProxy(object.__getattribute__(self, "_browser").new_page(**kwargs))


_NO_DISPLAY_RE = re.compile(r"XServer|Missing X server|\$DISPLAY|cannot open display", re.IGNORECASE)


def _launch_options(browser_type, kwargs, headless=None):
    headless = HEADLESS if headless is None else headless
    kwargs["headless"] = headless
    if not headless:
        kwargs.setdefault("slow_mo", 60)
    if browser_type.name == "chromium":
        base = ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors", "--window-size=1366,900", "--window-position=0,0"]
        kwargs["args"] = base + [arg for arg in kwargs.get("args", []) if arg not in base]
    return kwargs


class _BrowserTypeProxy:
    def __init__(self, browser_type):
        object.__setattr__(self, "_bt", browser_type)

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_bt"), name)

    def launch(self, **kwargs):
        browser_type = object.__getattribute__(self, "_bt")
        _emit("action", f"Abrindo navegador {browser_type.name} ({'headless' if HEADLESS else 'visivel'})")
        return _BrowserProxy(_launch_with_fallback(lambda opts: browser_type.launch(**opts), browser_type, kwargs))

    def launch_persistent_context(self, user_data_dir, **kwargs):
        browser_type = object.__getattribute__(self, "_bt")
        return _ContextProxy(_launch_with_fallback(lambda opts: browser_type.launch_persistent_context(user_data_dir, **opts), browser_type, kwargs))


def _launch_with_fallback(launcher, browser_type, kwargs):
    try:
        return launcher(_launch_options(browser_type, dict(kwargs)))
    except Exception as error:
        # Sem X server no servidor: em vez de falhar a execucao, reabre em headless.
        if HEADLESS or not _NO_DISPLAY_RE.search(str(error)):
            raise
        _emit("warn", "Display grafico indisponivel no servidor; reabrindo o navegador em modo headless")
        return launcher(_launch_options(browser_type, dict(kwargs), headless=True))


class _PlaywrightProxy:
    def __init__(self, playwright):
        object.__setattr__(self, "_pw", playwright)

    def __getattr__(self, name):
        value = getattr(object.__getattribute__(self, "_pw"), name)
        if name in ("chromium", "firefox", "webkit"):
            return _BrowserTypeProxy(value)
        return value

    def stop(self):
        return object.__getattribute__(self, "_pw").stop()


try:
    import playwright.sync_api as _pw_sync

    _original_sync_playwright = _pw_sync.sync_playwright

    class _SyncPlaywrightManager:
        def __init__(self):
            self._manager = _original_sync_playwright()

        def __enter__(self):
            return _PlaywrightProxy(self._manager.__enter__())

        def __exit__(self, *args):
            return self._manager.__exit__(*args)

        def start(self):
            return _PlaywrightProxy(self._manager.start())

    _pw_sync.sync_playwright = lambda: _SyncPlaywrightManager()
except Exception:
    pass  # Playwright nao instalado: scripts sem navegador continuam funcionando


# ─── Execucao do script do usuario ────────────────────────────────────────────
def _main():
    sys.argv = [USER_SCRIPT] + sys.argv[1:]
    sys.path.insert(0, os.path.dirname(USER_SCRIPT))
    try:
        runpy.run_path(USER_SCRIPT, run_name="__main__")
    except SystemExit as exit_error:
        code = exit_error.code
        if code not in (None, 0):
            if not isinstance(code, int):
                _emit("error", str(code))
                code = 1
            sys.exit(code)
    except BaseException:
        frames = traceback.format_exc()
        _emit("error", frames.strip())
        sys.exit(1)


_main()
