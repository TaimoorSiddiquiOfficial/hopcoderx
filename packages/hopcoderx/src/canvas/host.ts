/**
 * HopCoderX Canvas Host Server
 *
 * Bun HTTP + WebSocket server that:
 *   - Serves static files from ~/.hopcoderx/canvas/ (creates index.html if absent)
 *   - POST /canvas/a2ui/push  → broadcasts A2UI JSONL events to all WebSocket clients
 *   - POST /canvas/a2ui/reset → broadcasts a reset event
 *   - POST /canvas/*          → canvas control stubs (present, hide, navigate, eval, snapshot)
 *   - GET  /canvas/ws         → WebSocket upgrade (live-reload + A2UI push stream)
 *   - GET  /health            → ping response  { ok: true, canvas: true, clients: <n> }
 *
 * Config:
 *   HOPCODERX_CANVAS_PORT=3741   (default)
 *   HOPCODERX_CANVAS_ROOT        (default: ~/.hopcoderx/canvas)
 *   HOPCODERX_CANVAS_TOKEN       (optional Bearer token for auth)
 */

import { mkdir, writeFile, readFile, stat } from "fs/promises"
import { existsSync } from "fs"
import { join, extname } from "path"
import { homedir } from "os"
import type { ServerWebSocket } from "bun"
import type { A2UiEvent } from "./index"

const DEFAULT_PORT = 3741
const DEFAULT_ROOT = join(homedir(), ".hopcoderx", "canvas")
const WS_PATH = "/canvas/ws"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
}

const LIVE_RELOAD_SNIPPET = `
<script>
(()=>{
  const ws=new WebSocket("ws://"+location.host+"/canvas/ws");
  ws.onclose=()=>setTimeout(()=>location.reload(),2000);
  ws.onmessage=(e)=>{
    if(e.data==="reload"){location.reload();return;}
    try{renderA2Ui(JSON.parse(e.data));}catch(err){console.debug("canvas: failed to render A2UI", err)}
  };
  function renderA2Ui(ev){
    const el=document.getElementById("hopcoderx-a2ui-log");
    if(!el)return;
    if(ev.type==="reset"){el.textContent="";return;}
    const span=document.createElement("span");
    if(ev.type==="text")span.textContent=ev.content+"\n";
    else if(ev.type==="progress")span.textContent="⏳ "+(ev.label??"")+" "+(Math.round((ev.value??0)*100))+"%\n";
    else if(ev.type==="error"){span.style.color="#f87171";span.textContent="Error: "+ev.message+"\n";}
    else span.textContent=JSON.stringify(ev)+"\n";
    el.appendChild(span);
    el.scrollTop=el.scrollHeight;
  }
})();
</script>`

function defaultIndexHtml(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HopCoderX Canvas</title>
<style>
  html,body{height:100%;margin:0;background:#0d0d0d;color:#e0e0e0;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
  .wrap{min-height:100%;display:grid;place-items:center;padding:24px;}
  .card{width:min(760px,100%);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:20px;}
  h1{margin:0 0 4px;font-size:20px;letter-spacing:-.2px;}
  .sub{opacity:.55;font-size:13px;margin-bottom:16px;}
  .ok{color:#4ade80;} .warn{color:#facc15;} .err{color:#f87171;}
  #hopcoderx-a2ui-log{background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;min-height:140px;overflow:auto;max-height:60vh;}
</style>
<div class="wrap"><div class="card">
  <h1>HopCoderX Canvas</h1>
  <div class="sub">A2UI agent workspace — place your UI here or wait for agent events</div>
  <div id="hopcoderx-a2ui-log">Connecting…</div>
</div></div>
${LIVE_RELOAD_SNIPPET}
`
}

export interface CanvasHostOptions {
  port?: number
  rootDir?: string
  token?: string
}

export interface CanvasHost {
  port: number
  rootDir: string
  /** Broadcast an A2UI event directly (useful from daemon code) */
  broadcast(event: A2UiEvent): void
  stop(): void
}

export async function startCanvasHost(opts: CanvasHostOptions = {}): Promise<CanvasHost> {
  const port = opts.port ?? Number(process.env.HOPCODERX_CANVAS_PORT ?? DEFAULT_PORT)
  const rootDir = opts.rootDir ?? process.env.HOPCODERX_CANVAS_ROOT ?? DEFAULT_ROOT
  const token = opts.token ?? process.env.HOPCODERX_CANVAS_TOKEN

  await mkdir(rootDir, { recursive: true })
  const indexPath = join(rootDir, "index.html")
  if (!existsSync(indexPath)) {
    await writeFile(indexPath, defaultIndexHtml(), "utf8")
  }

  const clients = new Set<ServerWebSocket<unknown>>()

  const broadcast = (event: A2UiEvent) => {
    const msg = JSON.stringify(event)
    for (const ws of clients) {
      try { ws.send(msg) } catch {
        // Client disconnected, will be cleaned up by close handler
        clients.delete(ws)
      }
    }
  }

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    websocket: {
      open(ws) { clients.add(ws) },
      close(ws) { clients.delete(ws) },
      message() {},
    },
    async fetch(req, server) {
      const url = new URL(req.url)
      const path = url.pathname

      // Optional Bearer token auth (skip for health + WS upgrade)
      if (token && path !== "/health" && path !== "/canvas/ping" && path !== WS_PATH) {
        const auth = req.headers.get("authorization") ?? ""
        if (!auth.startsWith("Bearer ") || auth.slice(7) !== token) {
          return new Response("Unauthorized", { status: 401 })
        }
      }

      // WebSocket upgrade for live-reload + A2UI event stream
      if (path === WS_PATH) {
        const ok = server.upgrade(req)
        if (ok) return undefined as unknown as Response
        return new Response("WebSocket upgrade failed", { status: 426 })
      }

      // Health / ping
      if (path === "/health" || path === "/canvas/ping") {
        return Response.json({ ok: true, canvas: true, clients: clients.size })
      }

      // A2UI push: POST /canvas/a2ui/push
      if (path === "/canvas/a2ui/push" && req.method === "POST") {
        const body = await req.json() as { jsonl?: string; events?: A2UiEvent[] }
        const jsonl = body.jsonl ?? body.events?.map((e) => JSON.stringify(e)).join("\n") ?? ""
        const lines = jsonl.split("\n").filter(Boolean)
        for (const line of lines) {
          for (const ws of clients) {
            try { ws.send(line) } catch {
              // Client disconnected
              clients.delete(ws)
            }
          }
        }
        return Response.json({ ok: true, delivered: clients.size, lines: lines.length })
      }

      // A2UI reset: POST /canvas/a2ui/reset
      if (path === "/canvas/a2ui/reset" && req.method === "POST") {
        const msg = JSON.stringify({ type: "reset" })
        for (const ws of clients) {
          try { ws.send(msg) } catch {
            // Client disconnected
            clients.delete(ws)
          }
        }
        return Response.json({ ok: true })
      }

      // Canvas control stubs (present, hide, navigate, eval, snapshot)
      if (path.startsWith("/canvas/") && req.method === "POST") {
        const action = path.slice("/canvas/".length)
        if (action === "snapshot") {
          return Response.json({ base64: "", format: "png", width: 0, height: 0 })
        }
        return Response.json({ ok: true })
      }

      // Static file serving (GET / HEAD only)
      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 })
      }

      let filePath = join(rootDir, path === "/" ? "index.html" : path.replace(/\.\./g, ""))
      // Prevent path traversal
      if (!filePath.startsWith(rootDir)) {
        return new Response("Forbidden", { status: 403 })
      }

      try {
        const s = await stat(filePath)
        if (s.isDirectory()) filePath = join(filePath, "index.html")
      } catch (err) {
        // File doesn't exist
        return new Response("Not Found", { status: 404 })
      }

      try {
        const data = await readFile(filePath)
        const ext = extname(filePath).toLowerCase()
        const mimeType = MIME[ext] ?? "application/octet-stream"

        if (mimeType.startsWith("text/html")) {
          let html = data.toString("utf8")
          // Inject live-reload if not already present
          if (!html.includes(WS_PATH)) {
            html = html.replace("</body>", `${LIVE_RELOAD_SNIPPET}</body>`)
          }
          return new Response(html, { headers: { "Content-Type": mimeType, "Cache-Control": "no-store" } })
        }

        return new Response(data.buffer as ArrayBuffer, { headers: { "Content-Type": mimeType, "Cache-Control": "no-store" } })
      } catch (err) {
        // Read failed after stat succeeded
        return new Response("Not Found", { status: 404 })
      }
    },
  })

  return {
    port: server.port as number,
    rootDir,
    broadcast,
    stop() { server.stop() },
  }
}
