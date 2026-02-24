/**
 * BDR Local — local LLM gateway for HopCoderX development
 *
 * Mode A (default): proxies to Ollama
 *   OLLAMA_URL=http://localhost:11434  bun start
 *
 * Mode B (Portkey): proxies through live Railway Portkey AI Gateway (default when no OPENROUTER_API_KEY)
 *   Gateway URL: https://hopcoderx-bdr.up.railway.app
 *   Console:     https://hopcoderx-bdr.up.railway.app/public/
 *   Override:    PORTKEY_GATEWAY_URL=https://other-host.up.railway.app bun start
 *   BDR_PORTKEY_FREE_CONFIG=<base64-json>  # optional load-balance config
 *
 * Mode C (OpenRouter Preset): routes via OpenRouter preset — zero config load balancing
 *   OPENROUTER_API_KEY=sk-or-xxx bun start
 *   OPENROUTER_PRESET=hopcoder-free  # preset slug, default "hopcoder-free"
 *   Create your preset at https://openrouter.ai/settings/presets
 *
 * Then add to hopcoderx.json:
 *   {
 *     "provider": {
 *       "bdr-local": {
 *         "name": "BDR Local",
 *         "api": { "url": "http://localhost:4999/v1" },
 *         "npm": "@ai-sdk/openai-compatible"
 *       }
 *     }
 *   }
 */

import { handlePanel } from "./panel"

const PORT = Number(Bun.env.PORT ?? 4999)
const OLLAMA = (Bun.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "")
// Live Portkey Gateway on Railway — hop to https://hopcoderx-bdr.up.railway.app/public/ for logs
const PORTKEY = (Bun.env.PORTKEY_GATEWAY_URL ?? "https://hopcoderx-bdr.up.railway.app").replace(/\/$/, "")
const OPENROUTER_KEY = Bun.env.OPENROUTER_API_KEY
const OPENROUTER_PRESET = Bun.env.OPENROUTER_PRESET ?? "hopcoder-free"

// Build Portkey load-balance config from individual env var API keys.
// Manual BDR_PORTKEY_FREE_CONFIG (base64 JSON) always takes precedence.
function buildPortkeyConfig() {
  if (Bun.env.BDR_PORTKEY_FREE_CONFIG) return Bun.env.BDR_PORTKEY_FREE_CONFIG
  const targets: Array<Record<string, unknown>> = []
  if (Bun.env.OPENROUTER_API_KEY)
    targets.push({ provider: "openai", api_key: Bun.env.OPENROUTER_API_KEY, base_url: "https://openrouter.ai/api/v1", override_params: { model: `@preset/${OPENROUTER_PRESET}` }, weight: 3 })
  if (Bun.env.GROQ_API_KEY)
    targets.push({ provider: "groq", api_key: Bun.env.GROQ_API_KEY, override_params: { model: "llama-3.3-70b-versatile" }, weight: 2 })
  if (Bun.env.CEREBRAS_API_KEY)
    targets.push({ provider: "cerebras", api_key: Bun.env.CEREBRAS_API_KEY, override_params: { model: "llama3.1-70b" }, weight: 2 })
  if (Bun.env.TOGETHER_API_KEY)
    targets.push({ provider: "together-ai", api_key: Bun.env.TOGETHER_API_KEY, override_params: { model: "Qwen/Qwen2.5-72B-Instruct-Turbo" }, weight: 1 })
  if (Bun.env.GOOGLE_API_KEY)
    targets.push({ provider: "google", api_key: Bun.env.GOOGLE_API_KEY, override_params: { model: "gemini-2.0-flash-exp" }, weight: 1 })
  if (!targets.length) return undefined
  return btoa(JSON.stringify({ strategy: { mode: "loadbalance" }, retry: { attempts: 3, on_status_codes: [429, 500, 502, 503, 504] }, targets }))
}

const PORTKEY_CONFIG = buildPortkeyConfig()

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// Normalize path: strip /bdr prefix so /bdr/v1/... and /v1/... both work
function normalize(pathname: string) {
  return pathname.replace(/^\/bdr/, "")
}

// Static free-provider model list for non-Ollama modes
const FREE_MODEL_LIST = {
  object: "list",
  data: [
    { id: "@preset/hopcoder-free", object: "model", created: 0, owned_by: "openrouter" },
    { id: "llama-3.3-70b-versatile", object: "model", created: 0, owned_by: "groq" },
    { id: "llama3.1-70b", object: "model", created: 0, owned_by: "cerebras" },
    { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", object: "model", created: 0, owned_by: "together-ai" },
    { id: "gemini-2.0-flash-exp", object: "model", created: 0, owned_by: "google" },
  ],
}

async function listModels() {
  if (OPENROUTER_KEY || PORTKEY) return FREE_MODEL_LIST
  const res = await fetch(`${OLLAMA}/api/tags`)
  if (!res.ok) throw new Error(`Ollama unavailable (${res.status})`)
  const { models } = (await res.json()) as {
    models: Array<{ name: string; modified_at: string; size: number }>
  }
  return {
    object: "list",
    data: models.map((m) => ({
      id: m.name,
      object: "model",
      created: Math.floor(new Date(m.modified_at).getTime() / 1000),
      owned_by: "ollama",
    })),
  }
}

async function chat(req: Request) {
  const body = await req.json()
  const isStream = !!body.stream

  // Mode C: OpenRouter Preset — use @preset/<slug> as model, OR routes internally
  if (OPENROUTER_KEY) {
    // If caller sent a generic model, replace with the preset
    const model = (body.model as string)?.startsWith("@preset/")
      ? body.model
      : `@preset/${OPENROUTER_PRESET}`
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": "https://hopcoder.dev",
        "X-Title": "HopCoderX BDR",
      },
      body: JSON.stringify({ ...body, model }),
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": isStream ? "text/event-stream" : "application/json",
        "Cache-Control": "no-cache",
        ...CORS,
      },
    })
  }

  // Mode B: Portkey Gateway — load-balanced across free providers
  if (PORTKEY) {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (PORTKEY_CONFIG) headers["x-portkey-config"] = PORTKEY_CONFIG
    // Forward auth + any x-portkey-* headers from caller (supports Portkey cloud virtual keys)
    const auth = req.headers.get("authorization")
    if (auth) headers["authorization"] = auth
    for (const [k, v] of req.headers.entries()) {
      if (k.startsWith("x-portkey-")) headers[k] = v
    }
    const upstream = await fetch(`${PORTKEY}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": isStream ? "text/event-stream" : "application/json",
        "Cache-Control": "no-cache",
        ...CORS,
      },
    })
  }

  // Ollama mode (default)
  const upstream = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": isStream ? "text/event-stream" : "application/json",
      "Cache-Control": "no-cache",
      ...CORS,
    },
  })
}


Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const { pathname } = new URL(req.url)
    const path = normalize(pathname)

    if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS })

    if (req.method === "GET" && path.startsWith("/v1/models")) {
      const data = await listModels().catch((e) => {
        throw new Error(`Failed to list Ollama models: ${e.message}`)
      })
      return Response.json(data, { headers: CORS })
    }

    if (req.method === "POST" && path.startsWith("/v1/chat/completions")) {
      return chat(req)
    }

    // Panel — web UI at /panel (and /panel/*)
    if (path.startsWith("/panel")) {
      return handlePanel(req, path).catch((e: Error) => Response.json({ error: e.message }, { status: 500 }))
    }

    // Health / root
    if (path === "/" || path === "/health") {
      const mode = OPENROUTER_KEY ? "openrouter" : PORTKEY ? "portkey" : "ollama"
      const upstream = OPENROUTER_KEY ? `openrouter/@preset/${OPENROUTER_PRESET}` : PORTKEY ?? OLLAMA
      return Response.json({ ok: true, mode, upstream, panel: `http://localhost:${PORT}/panel` }, { headers: CORS })
    }

    return Response.json({ error: "not_found", path }, { status: 404, headers: CORS })
  },
  error(err: Error) {
    console.error("[error]", err.message)
    return Response.json({ error: err.message }, { status: 500, headers: CORS })
  },
})

// Print startup info
const models = await listModels().catch(() => null)
const mode = OPENROUTER_KEY ? "openrouter" : PORTKEY ? "portkey" : "ollama"
console.log(`\n  BDR Local`)
console.log(`  ─────────────────────────────────────`)
console.log(`  API    http://localhost:${PORT}/v1`)
console.log(`  Panel  http://localhost:${PORT}/panel`)
if (mode === "openrouter") {
  console.log(`  Mode   OpenRouter Preset (@preset/${OPENROUTER_PRESET})`)
  console.log(`  Preset https://openrouter.ai/settings/presets`)
} else if (mode === "portkey") {
  console.log(`  Mode   Portkey Gateway`)
  console.log(`  Gate   ${PORTKEY}`)
  console.log(`  Logs   ${PORTKEY}/public/`)
  const providers = [Bun.env.OPENROUTER_API_KEY && "openrouter", Bun.env.GROQ_API_KEY && "groq", Bun.env.CEREBRAS_API_KEY && "cerebras", Bun.env.TOGETHER_API_KEY && "together", Bun.env.GOOGLE_API_KEY && "google"].filter(Boolean)
  if (providers.length) console.log(`  Providers ${providers.join(", ")}`)
  else console.log(`  Config  ${PORTKEY_CONFIG ? "custom (BDR_PORTKEY_FREE_CONFIG)" : "pass-through (set provider API keys)"}`)
} else {
  console.log(`  Mode   Ollama`)
  console.log(`  Ollama ${OLLAMA}`)
}
if (models) {
  console.log(`  Models ${models.data.map((m) => m.id).join(", ") || "(none)"}`)
} else {
  console.log(`  Models ⚠  upstream not reachable`)
}
console.log(`\n  hopcoderx.json provider snippet:`)
console.log(`  ─────────────────────────────────────`)
console.log(`  "bdr-local": {`)
console.log(`    "name": "BDR Local",`)
console.log(`    "npm": "@ai-sdk/openai-compatible",`)
console.log(`    "api": { "url": "http://localhost:${PORT}/v1" }`)
console.log(`  }\n`)
