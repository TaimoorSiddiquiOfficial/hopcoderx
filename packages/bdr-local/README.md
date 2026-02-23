# BDR Local — Railway Deployment (Ubuntu)

A lightweight OpenAI-compatible gateway that proxies to [Ollama](https://ollama.ai).  
Runs locally or on **Railway** as an always-on Ubuntu server — no Cloudflare account needed.

---

## Local development

```bash
# From repo root
bun run --cwd packages/bdr-local dev
# or
cd packages/bdr-local && bun dev
```

Proxies `http://localhost:4999/v1/*` → Ollama at `http://localhost:11434`.

---

## Deploy to Railway (Ubuntu server)

### Prerequisites

- [Railway CLI](https://docs.railway.com/guides/cli) installed and `railway login` done
- [Railway account](https://railway.com) with a project created

### One-click deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/TaimoorSiddiquiOfficial/hopcoderx&serviceRootDirectory=packages/bdr-local)

### Manual steps

```bash
# 1. Link the service (run from repo root)
cd packages/bdr-local
railway link          # select or create a project

# 2. Set the Ollama URL environment variable (point to your Ollama instance)
railway variables set OLLAMA_URL=https://your-ollama-host.railway.internal

# 3. Deploy — Railway builds the Ubuntu Dockerfile automatically
railway up

# 4. Generate a public domain
railway domain
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4999` | HTTP port (Railway overrides automatically) |
| `OLLAMA_URL` | `http://localhost:11434` | URL of your Ollama instance |

> **Tip**: Deploy an Ollama service on Railway first, then set `OLLAMA_URL` to its internal hostname (`http://ollama.railway.internal:11434`).

---

## Add to hopcoderx.json after deploy

```json
{
  "provider": {
    "bdr-remote": {
      "name": "BDR Remote (Railway)",
      "npm": "@ai-sdk/openai-compatible",
      "api": {
        "url": "https://YOUR-RAILWAY-DOMAIN.up.railway.app/v1"
      }
    }
  }
}
```

---

## MCP — manage Railway from HopCoderX agents

The workspace `.vscode/mcp.json` already includes the [Railway MCP server](https://github.com/railwayapp/railway-mcp-server).  
Agents can `deploy`, `list-services`, `get-logs`, `set-variables`, and more — all via natural language.

Requires the Railway CLI to be installed:

```bash
# macOS / Linux
curl -fsSL https://install.railway.app | sh

# Windows
scoop install railway
```

Then authenticate:

```bash
railway login
```

Available agent commands (via MCP):

| Tool | What it does |
|---|---|
| `list-projects` | Show all Railway projects |
| `deploy` | Deploy the current service |
| `get-logs` | Stream build / runtime logs |
| `set-variables` | Set env vars without the dashboard |
| `generate-domain` | Create a `.up.railway.app` domain |
| `deploy-template` | Deploy Postgres, Redis, MySQL from template |
