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
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
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

EXPOSE 5174

# Xvfb inicia o display virtual — headless=False abre o Chromium nele.
# Os logs JSON do script são capturados pelo Node e exibidos na UI em tempo real.
CMD ["bash", "-lc", "Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & sleep 1 && node server/index.js"]
