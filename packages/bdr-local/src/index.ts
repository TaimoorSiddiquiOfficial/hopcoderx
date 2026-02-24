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
import { getAllProviderKeys, getSession, getUserByToken, recordUsage, getUsageToday, PLAN_QUOTA, hasUsers } from "./db"

const PORT = Number(Bun.env.PORT ?? 4999)
const OLLAMA = (Bun.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "")
// Live Portkey Gateway on Railway — hop to https://hopcoderx-bdr.up.railway.app/public/ for logs
const PORTKEY = (Bun.env.PORTKEY_GATEWAY_URL ?? "https://hopcoderx-bdr.up.railway.app").replace(/\/$/, "")
const OPENROUTER_PRESET = Bun.env.OPENROUTER_PRESET ?? "hopcoder-free"

// TTL-cached merged key lookup: env vars take precedence, panel DB keys fill in the rest.
// Cache TTL = 30s so panel changes (add/delete) take effect without restart.
let keyCache: { map: Record<string, string>; ts: number } | null = null

function mergedKeys() {
  const now = Date.now()
  if (keyCache && now - keyCache.ts < 30_000) return keyCache.map
  const map: Record<string, string> = {}
  for (const { provider, value } of getAllProviderKeys()) map[provider] = value
  // Env vars always win
  if (Bun.env.OPENROUTER_API_KEY) map["openrouter"] = Bun.env.OPENROUTER_API_KEY
  if (Bun.env.GROQ_API_KEY) map["groq"] = Bun.env.GROQ_API_KEY
  if (Bun.env.CEREBRAS_API_KEY) map["cerebras"] = Bun.env.CEREBRAS_API_KEY
  if (Bun.env.TOGETHER_API_KEY) map["together-ai"] = Bun.env.TOGETHER_API_KEY
  if (Bun.env.GOOGLE_API_KEY) map["google"] = Bun.env.GOOGLE_API_KEY
  keyCache = { map, ts: now }
  return map
}

// Build Portkey load-balance config from merged env+DB keys.
// Manual BDR_PORTKEY_FREE_CONFIG (base64 JSON) always takes precedence.
function buildPortkeyConfig() {
  if (Bun.env.BDR_PORTKEY_FREE_CONFIG) return Bun.env.BDR_PORTKEY_FREE_CONFIG
  const keys = mergedKeys()
  const targets: Array<Record<string, unknown>> = []
  if (keys["openrouter"])
    targets.push({ provider: "openai", api_key: keys["openrouter"], base_url: "https://openrouter.ai/api/v1", override_params: { model: `@preset/${OPENROUTER_PRESET}` }, weight: 3 })
  if (keys["groq"])
    targets.push({ provider: "groq", api_key: keys["groq"], override_params: { model: "llama-3.3-70b-versatile" }, weight: 2 })
  if (keys["cerebras"])
    targets.push({ provider: "cerebras", api_key: keys["cerebras"], override_params: { model: "llama3.1-70b" }, weight: 2 })
  if (keys["together-ai"])
    targets.push({ provider: "together-ai", api_key: keys["together-ai"], override_params: { model: "Qwen/Qwen2.5-72B-Instruct-Turbo" }, weight: 1 })
  if (keys["google"])
    targets.push({ provider: "google", api_key: keys["google"], override_params: { model: "gemini-2.0-flash-exp" }, weight: 1 })
  if (!targets.length) return undefined
  return btoa(JSON.stringify({ strategy: { mode: "loadbalance" }, retry: { attempts: 3, on_status_codes: [429, 500, 502, 503, 504] }, targets }))
}

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
  if (mergedKeys()["openrouter"] || PORTKEY) return FREE_MODEL_LIST
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
  const keys = mergedKeys()

  // Mode C: OpenRouter Preset — use @preset/<slug> as model, OR routes internally
  const orKey = keys["openrouter"]
  if (orKey) {
    // If caller sent a generic model, replace with the preset
    const model = (body.model as string)?.startsWith("@preset/")
      ? body.model
      : `@preset/${OPENROUTER_PRESET}`
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
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
    const config = buildPortkeyConfig()
    if (config) headers["x-portkey-config"] = config
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
      // Auth + quota gate — users pass their BDR API key (bdrk_…) from hopcoderx.json
      const raw = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
      const user = raw.startsWith("bdrk_") ? getUserByToken(raw) : raw ? getSession(raw) : null

      // Only enforce auth once someone has registered — dev setups with no users pass through
      if (hasUsers()) {
        if (!user) return Response.json({ error: "unauthorized", message: "Set your BDR API key in hopcoderx.json: provider.bdr-local.api.key = \"bdrk_…\"" }, { status: 401, headers: CORS })
        const quota = PLAN_QUOTA[user.role === "admin" ? "admin" : user.plan] ?? PLAN_QUOTA.free
        if (quota !== -1) {
          const used = getUsageToday(user.id)
          if (used >= quota)
            return Response.json({ error: "quota_exceeded", message: `Daily limit reached (${used}/${quota} requests). Upgrade your plan at the BDR panel.`, used, quota }, { status: 429, headers: CORS })
        }
        recordUsage(user.id, (await req.clone().json().catch(() => ({}))).model ?? null)
      }
      return chat(req)
    }

    // Panel — web UI at /panel (and /panel/*)
    if (path.startsWith("/panel")) {
      return handlePanel(req, path).catch((e: Error) => Response.json({ error: e.message }, { status: 500 }))
    }

    // Health / root
    if (path === "/" || path === "/health") {
      const keys = mergedKeys()
      const mode = keys["openrouter"] ? "openrouter" : PORTKEY ? "portkey" : "ollama"
      const upstream = keys["openrouter"] ? `openrouter/@preset/${OPENROUTER_PRESET}` : PORTKEY ?? OLLAMA
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
const startKeys = mergedKeys()
const models = await listModels().catch(() => null)
const mode = startKeys["openrouter"] ? "openrouter" : PORTKEY ? "portkey" : "ollama"
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
  const providers = (["openrouter", "groq", "cerebras", "together-ai", "google"] as const).filter(p => startKeys[p])
  if (providers.length) console.log(`  Providers ${providers.join(", ")}`)
  else console.log(`  Config  ${Bun.env.BDR_PORTKEY_FREE_CONFIG ? "custom (BDR_PORTKEY_FREE_CONFIG)" : "pass-through (add keys in panel or via env vars)"}`)
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
