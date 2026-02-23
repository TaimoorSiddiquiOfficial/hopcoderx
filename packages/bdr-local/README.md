# BDR Local — Railway Deployment (Ubuntu)

A lightweight OpenAI-compatible gateway with **three upstream modes**:

| Mode | Env var | Best for |
|---|---|---|
| **OpenRouter Preset** (recommended) | `OPENROUTER_API_KEY` | Zero-config free-tier routing via OpenRouter preset |
| **Portkey Gateway** | `PORTKEY_GATEWAY_URL` | Self-hosted Railway Ubuntu container with load balancing |
| **Ollama** (default) | `OLLAMA_URL` | Local GPU inference |

---

## Mode A — OpenRouter Preset (recommended for free tier)

The simplest option. Create a named preset on OpenRouter that handles load balancing, fallbacks, and rate-limit retries across Groq/Cerebras/Gemini/Together — without you managing any provider config.

### 1. Create the preset

1. Go to [openrouter.ai/settings/presets](https://openrouter.ai/settings/presets) → **New Preset**
2. Name it `hopcoder-free`
3. Add providers: Groq (Llama 3.3 70B), Cerebras (Llama 3.1 70B), Google (Gemini Flash), Together (Qwen 2.5 72B)
4. Set routing to **Load Balance** or **Lowest Latency**
5. Save → get your `OPENROUTER_API_KEY`

### 2. Start bdr-local

```bash
OPENROUTER_API_KEY=sk-or-xxx bun start
# or custom preset name:
OPENROUTER_API_KEY=sk-or-xxx OPENROUTER_PRESET=my-preset bun start
```

### 3. Use in hopcoderx.json

```json
{
  "provider": {
    "bdr-local": {
      "name": "BDR (OpenRouter Free)",
      "npm": "@ai-sdk/openai-compatible",
      "api": { "url": "http://localhost:4999/v1" }
    }
  }
}
```

All agent steps automatically use `@preset/hopcoder-free` as the model string — OpenRouter routes to whichever free provider has capacity.

---

## Mode B — Self-hosted Portkey Gateway on Railway

See [`../portkey-gateway/README.md`](../portkey-gateway/README.md).

```bash
PORTKEY_GATEWAY_URL=https://your-portkey.up.railway.app bun start
# optionally with load-balance config:
BDR_PORTKEY_FREE_CONFIG=<base64-json> bun start
```

---

## Mode C — Ollama (default)

```bash
# From repo root
bun run --cwd packages/bdr-local dev
```

Proxies `http://localhost:4999/v1/*` → Ollama at `http://localhost:11434`.

---

## Deploy to Railway (Ubuntu server)

### Prerequisites

- [Railway CLI](https://docs.railway.com/guides/cli) installed and `railway login` done

### Manual steps

```bash
cd packages/bdr-local
railway link          # Root Directory = packages/bdr-local
railway variables set OPENROUTER_API_KEY=sk-or-xxx
railway variables set OPENROUTER_PRESET=hopcoder-free
railway up
railway domain        # get your .up.railway.app URL
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4999` | HTTP port (Railway overrides automatically) |
| `OPENROUTER_API_KEY` | — | Enables OpenRouter preset mode |
| `OPENROUTER_PRESET` | `hopcoder-free` | OpenRouter preset slug |
| `PORTKEY_GATEWAY_URL` | — | Enables Portkey mode (overridden by OPENROUTER_API_KEY) |
| `BDR_PORTKEY_FREE_CONFIG` | — | Base64 Portkey routing JSON |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama URL (used in default mode) |

---

## MCP — manage Railway from HopCoderX agents

The workspace `.vscode/mcp.json` already includes the [Railway MCP server](https://github.com/railwayapp/railway-mcp-server).

```bash
railway login
```

Prompt: `Deploy bdr-local to Railway with OPENROUTER_API_KEY=sk-or-xxx and generate a domain`

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
