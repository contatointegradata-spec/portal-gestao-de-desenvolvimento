#!/bin/bash
# Script de inicialização do container
# Garante que todos os serviços sobem na ordem correta

set -e

echo "[start.sh] Iniciando Xvfb no DISPLAY :99 (1920x1080)..."
# Lock/socket orfaos de um restart anterior impedem o Xvfb de subir.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

# Aguarda o Xvfb estar pronto
sleep 2

echo "[start.sh] Iniciando window manager (openbox)..."
DISPLAY=:99 openbox --config-file /dev/null >/tmp/openbox.log 2>&1 &

sleep 1

echo "[start.sh] Iniciando x11vnc na porta 5900..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever -shared \
  -noxdamage >/tmp/x11vnc.log 2>&1 &

sleep 1

echo "[start.sh] Iniciando noVNC na porta 6080..."
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &

echo "[start.sh] Todos os serviços de display iniciados."
echo "[start.sh] Acesse o display em: http://SEU_SERVIDOR:6080/vnc.html"
echo "[start.sh] Iniciando servidor Node.js..."

exec node server/index.js
