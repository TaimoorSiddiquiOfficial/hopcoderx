# BDR Local — Ubuntu 22.04 + Bun
# Deploy to Railway: set Root Directory → packages/bdr-local
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Bun (latest stable)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# Copy package manifest and install deps (prod only)
COPY package.json ./
RUN bun install --production

# Copy source and panel UI (combined to bust Railway layer cache)
COPY . .

# Persistent volume for SQLite panel DB
# In Railway: add a Volume → mount path /data
RUN mkdir -p /data
ENV PANEL_DB_PATH=/data/panel.db

# Railway injects PORT; default 4999
ENV PORT=4999
EXPOSE ${PORT}

# Health check — Railway polls /health
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["bun", "src/index.ts"]
