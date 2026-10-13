FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Evita prompts interativos do apt (tzdata, etc.)
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo

ENV NODE_ENV=production
ENV PORT=5174
ENV DISPLAY=:99
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ── Python3 + pip ──────────────────────────────────────────────────────────────
# x11vnc + novnc: transmitem ao vivo a tela virtual (Xvfb) para a plataforma (porta 6080).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

# ── Dependências Python ────────────────────────────────────────────────────────
COPY wheelhouse_linux/ /tmp/wheelhouse_linux/

RUN pip3 install --no-index --find-links=/tmp/wheelhouse_linux pandas openpyxl \
    && pip3 install playwright==1.59.0 \
    && rm -rf /tmp/wheelhouse_linux

# ── Dependências Node.js ───────────────────────────────────────────────────────
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Código da aplicação ────────────────────────────────────────────────────────
COPY . .

EXPOSE 5174 6080

# Xvfb inicia o display virtual — headless=False abre o Chromium nele.
# O lock/socket do Xvfb sobrevive ao restart do container (/tmp persiste) e impede o
# Xvfb de subir de novo; por isso sao removidos antes. Se o Xvfb cair, o runner o
# reinicia sob demanda (server/rpa/display.js), assim como o x11vnc/noVNC da transmissao.
# Os logs JSON do script são capturados pelo Node e exibidos na UI em tempo real.
CMD ["bash", "-lc", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1366x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & sleep 1 && exec node server/index.js"]
