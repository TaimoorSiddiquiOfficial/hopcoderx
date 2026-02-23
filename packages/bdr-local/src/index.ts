/**
 * BDR Local — local LLM gateway for HopCoderX development
 *
 * Runs a BDR-compatible (OpenAI) API server that proxies to Ollama.
 * Use this locally instead of the deployed BDR cloud gateway.
 *
 * Usage:
 *   bun start                   # start server
 *   OLLAMA_URL=http://...  bun start
 *   PORT=5000 bun start
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

const PORT = Number(Bun.env.PORT ?? 4999)
const OLLAMA = (Bun.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// Normalize path: strip /bdr prefix so /bdr/v1/... and /v1/... both work
function normalize(pathname: string) {
  return pathname.replace(/^\/bdr/, "")
}

async function listModels() {
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

async function chat(req: Request, path: string) {
  const body = await req.json()
  const isStream = !!body.stream

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
  async fetch(req) {
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
      return chat(req, path)
    }

    // Health / root
    if (path === "/" || path === "/health") {
      return Response.json({ ok: true, ollama: OLLAMA }, { headers: CORS })
    }

    return Response.json({ error: "not_found", path }, { status: 404, headers: CORS })
  },
  error(err) {
    console.error("[error]", err.message)
    return Response.json({ error: err.message }, { status: 500, headers: CORS })
  },
})

// Print startup info
const models = await listModels().catch(() => null)
console.log(`\n  BDR Local`)
console.log(`  ─────────────────────────────────────`)
console.log(`  API    http://localhost:${PORT}/v1`)
console.log(`  Ollama ${OLLAMA}`)
if (models) {
  console.log(`  Models ${models.data.length > 0 ? models.data.map((m) => m.id).join(", ") : "(none pulled yet)"}`)
} else {
  console.log(`  Models ⚠  Ollama not reachable — run: ollama serve`)
}
console.log(`\n  hopcoderx.json provider snippet:`)
console.log(`  ─────────────────────────────────────`)
console.log(`  "bdr-local": {`)
console.log(`    "name": "BDR Local",`)
console.log(`    "npm": "@ai-sdk/openai-compatible",`)
console.log(`    "api": { "url": "http://localhost:${PORT}/v1" }`)
console.log(`  }\n`)
