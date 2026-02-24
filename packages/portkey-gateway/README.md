# Portkey AI Gateway — Railway (Ubuntu)

Self-hosted [Portkey AI Gateway](https://github.com/Portkey-AI/gateway) on Railway.  
Routes to 250+ LLMs with **load balancing, automatic retries, fallbacks, and guardrails** in a single endpoint.

Used by BDR free-tier routing: Groq → Cerebras → Together AI → Gemini Flash (auto-fallback on 429).

---

## Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/TaimoorSiddiquiOfficial/hopcoderx&serviceRootDirectory=packages/portkey-gateway)

### Manual steps

```bash
cd packages/portkey-gateway
railway login
railway link          # select/create project, Root Directory = packages/portkey-gateway
railway up
railway domain        # get your .up.railway.app URL
```

**Live gateway:** `https://hopcoderx-bdr.up.railway.app/v1`  
**Gateway console (logs & traces):** `https://hopcoderx-bdr.up.railway.app/public/`  
Custom gateway runs at: `https://YOUR-DOMAIN.up.railway.app/v1`

---

## Configure free-provider load balancing

1. Edit `config/free-providers.json` — fill in your API keys for each provider
2. Base64-encode it:

```bash
# Linux / macOS
cat config/free-providers.json | base64 -w 0

# Windows PowerShell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content config\free-providers.json -Raw)))
```

3. Set as Railway env var:

```bash
railway variables set BDR_PORTKEY_FREE_CONFIG=<base64-string>
```

---

## Wire into BDR Local

BDR Local defaults to the live gateway — no env var needed:

```bash
# Portkey mode is auto-active when no OPENROUTER_API_KEY is set
# Default: PORTKEY_GATEWAY_URL=https://hopcoderx-bdr.up.railway.app
bun --cwd packages/bdr-local start

# Override with your own deployment:
PORTKEY_GATEWAY_URL=https://YOUR-DOMAIN.up.railway.app bun start
BDR_PORTKEY_FREE_CONFIG=<base64 of config/free-providers.json>
```

BDR Local automatically proxies `/v1/chat/completions` through the gateway.

---

## Supported providers (free tier pre-configured)

| Provider | Model | rpm limit |
|---|---|---|
| Groq | llama-3.3-70b-versatile | 30 |
| Cerebras | llama3.1-70b | 30 |
| Together AI | Qwen2.5-72B-Instruct-Turbo | — |
| Google | gemini-2.0-flash-exp | 15 |

Portkey automatically retries on 429 and routes to the next available provider.

---

## Direct API usage

The gateway is OpenAI-compatible. Pass a routing config via header:

```bash
# Simple request with provider selection
curl https://hopcoderx-bdr.up.railway.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-portkey-provider: groq" \
  -H "Authorization: Bearer sk-groq-xxx" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}]}'

# Load-balanced across free providers (base64 config)
curl https://hopcoderx-bdr.up.railway.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-portkey-config: $(cat config/free-providers.json | base64 -w0)" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}]}'
```

---

## Gateway console

**Live (Railway):** https://hopcoderx-bdr.up.railway.app/public/

View logs, traces, and metrics locally:

```
http://localhost:8787/public/
```

---

## Local development

```bash
cd packages/portkey-gateway
npx @portkey-ai/gateway    # starts on :8787
```
