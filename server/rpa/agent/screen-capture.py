"""
Captura da tela do servidor de execucao — Gestao de Sistemas Unimed.

Usado pelo agente (gestao-rpa-agent.cjs) para transmitir a area de trabalho do servidor
para a plataforma, somente enquanto alguem esta assistindo. Processo persistente:
a cada linha "cap" recebida no stdin, devolve no stdout:
    OK <bytes> <largura> <altura>\n<jpeg>     ou     ERR <mensagem>\n

Requer Pillow (pip install pillow); usa mss se estiver instalado (mais rapido).
"""
import io
import sys

MAX_WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
QUALITY = int(sys.argv[2]) if len(sys.argv) > 2 else 60

try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import mss
    _sct = getattr(mss, "MSS", None)() if hasattr(mss, "MSS") else mss.mss()
except Exception:
    _sct = None

if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

out = sys.stdout.buffer


def send(header, payload=b""):
    out.write(header.encode("ascii", "replace") + b"\n")
    if payload:
        out.write(payload)
    out.flush()


def grab():
    if _sct is not None:
        monitor = _sct.monitors[0]  # todos os monitores
        shot = _sct.grab(monitor)
        return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    from PIL import ImageGrab
    return ImageGrab.grab(all_screens=True)


def capture():
    image = grab()
    width, height = image.size
    if width > MAX_WIDTH:
        image = image.resize((MAX_WIDTH, round(height * MAX_WIDTH / width)), Image.BILINEAR)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=QUALITY, optimize=False)
    return buffer.getvalue(), width, height


def main():
    # Uma resposta por comando: o agente pareia cada "cap" com a proxima linha OK/ERR.
    for line in sys.stdin:
        command = line.strip()
        if command == "quit":
            break
        if Image is None:
            send("ERR Pillow nao instalado no servidor. Rode: pip install pillow mss")
            continue
        try:
            data, width, height = capture()
            send(f"OK {len(data)} {width} {height}", data)
        except Exception as error:  # sessao desconectada, tela bloqueada, etc.
            send("ERR " + " ".join(str(error).split()))


if __name__ == "__main__":
    main()
