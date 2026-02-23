# Portkey AI Gateway — Ubuntu 22.04
# Routes to 250+ LLMs with fallbacks, retries, load balancing
# Deploy: set Root Directory → packages/portkey-gateway in Railway

FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

# Copy gateway config
COPY conf.json ./

# Install Portkey gateway globally (pinned version)
RUN npm install -g @portkey-ai/gateway@1.15.2

EXPOSE ${PORT}

# Health check — Railway polls /
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:${PORT}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["portkey-gateway"]
