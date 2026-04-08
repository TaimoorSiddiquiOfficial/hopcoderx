/**
 * `hopcoderx webhooks` — HTTP webhook receiver.
 *
 * Creates a local HTTP server that receives GitHub/GitLab/Linear/custom webhooks
 * and can trigger agent sessions automatically.
 *
 * Sub-commands:
 *   webhooks listen [--port]     Start webhook receiver
 *   webhooks list                List registered webhooks
 *   webhooks add <url-path>      Register a new webhook endpoint
 *   webhooks delete <id>         Delete a webhook
 *   webhooks test <id>           Send a test payload
 *   webhooks logs                Show recent webhook events
 */

import { createServer } from "http"
import { join } from "path"
import { Global } from "../../global"
import { randomUUID } from "crypto"
import type { Argv } from "yargs"
import { cmd } from "./cmd"

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  id: string
  path: string
  name: string
  source: "github" | "gitlab" | "linear" | "custom"
  /** Events to react to (e.g. 'push', 'pull_request', 'issues') */
  events: string[]
  /** Shell command or hopcoderx command to run on match */
  action?: string
  enabled: boolean
  secret?: string
  createdAt: number
  hitCount: number
}

export interface WebhookEvent {
  id: string
  webhookId: string
  ts: number
  source: string
  event: string
  payload: Record<string, any>
  status: "received" | "processed" | "error"
}

// ─── Storage ───────────────────────────────────────────────────────────────────

function configPath() { return join(Global.Path.data, "webhooks.json") }
function logPath()    { return join(Global.Path.data, "webhook-events.jsonl") }

function readConfigs(): WebhookConfig[] {
  try {
    const fs = require("fs") as typeof import("fs")
    return JSON.parse(fs.readFileSync(configPath(), "utf8"))
  } catch { return [] }
}

function writeConfigs(configs: WebhookConfig[]): void {
  const fs = require("fs") as typeof import("fs")
  fs.mkdirSync(Global.Path.data, { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(configs, null, 2), "utf8")
}

function appendEvent(evt: WebhookEvent): void {
  const fs = require("fs") as typeof import("fs")
  fs.mkdirSync(Global.Path.data, { recursive: true })
  fs.appendFileSync(logPath(), JSON.stringify(evt) + "\n", "utf8")
}

function readEvents(limit = 50): WebhookEvent[] {
  try {
    const fs = require("fs") as typeof import("fs")
    return fs.readFileSync(logPath(), "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as WebhookEvent).slice(-limit)
  } catch { return [] }
}

// ─── Webhook server ────────────────────────────────────────────────────────────

function detectEvent(headers: Record<string, string | string[] | undefined>, body: any): { source: string; event: string } {
  const gh = headers["x-github-event"]
  if (gh) return { source: "github", event: String(gh) }
  const gl = headers["x-gitlab-event"]
  if (gl) return { source: "gitlab", event: String(gl) }
  const lin = headers["linear-event"]
  if (lin) return { source: "linear", event: String(lin) }
  return { source: "custom", event: body?.event ?? "unknown" }
}

async function startWebhookServer(port: number): Promise<void> {
  const configs = readConfigs()
  const server = createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/"
    const wh = configs.find((c) => c.enabled && c.path === urlPath)

    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      let parsed: any = {}
      try { parsed = JSON.parse(body) } catch {}

      const { source, event } = detectEvent(req.headers as any, parsed)

      if (wh) {
        const evt: WebhookEvent = {
          id: randomUUID().slice(0, 8),
          webhookId: wh.id,
          ts: Date.now(),
          source,
          event,
          payload: parsed,
          status: "received",
        }
        appendEvent(evt)

        // Update hit count
        wh.hitCount = (wh.hitCount ?? 0) + 1
        writeConfigs(configs)

        // Run action if configured
        if (wh.action && wh.events.includes(event)) {
          const { exec } = require("child_process")
          exec(wh.action, { env: { ...process.env, WEBHOOK_EVENT: event, WEBHOOK_SOURCE: source } })
          evt.status = "processed"
        }

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true, id: evt.id }))
        console.log(`[webhook] ${source}/${event} → ${urlPath} (id=${evt.id})`)
      } else {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "no webhook registered at this path" }))
        console.log(`[webhook] 404 ${urlPath} — no handler`)
      }
    })
  })

  server.listen(port, () => {
    console.log(`\n🪝 Webhook receiver listening on http://localhost:${port}`)
    console.log(`   Registered endpoints:`)
    for (const wh of configs.filter((c) => c.enabled)) {
      console.log(`     ${wh.source.padEnd(8)}  http://localhost:${port}${wh.path}  (${wh.name})`)
    }
    console.log("\n   Press Ctrl+C to stop.\n")
  })

  await new Promise<void>((_, reject) => {
    server.on("error", reject)
    process.on("SIGINT", () => { server.close(); process.exit(0) })
  })
}

// ─── CLI ────────────────────────────────────────────────────────────────────────

export const WebhooksCommand = cmd({
  command: "webhooks [action]",
  describe: "HTTP webhook receiver — trigger agent actions from GitHub/GitLab/Linear events",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["listen", "list", "add", "delete", "test", "logs"] as const,
        default: "list",
      })
      .option("port",   { alias: "p", type: "number",  description: "Port to listen on",  default: 7890 })
      .option("path",   { type: "string",  description: "URL path (e.g. /github)" })
      .option("name",   { alias: "n", type: "string",  description: "Webhook name" })
      .option("source", { type: "string",  description: "Source: github|gitlab|linear|custom", default: "custom" })
      .option("events", { type: "array",   description: "Events to handle" })
      .option("action-cmd", { type: "string", description: "Shell command to run on event" })
      .option("id",     { type: "string",  description: "Webhook ID" })
      .option("lines",  { type: "number",  description: "Log lines to show", default: 30 }),
  handler: async (args: {
    action?: string
    port?: number
    path?: string
    name?: string
    source?: string
    events?: (string | number)[]
    "action-cmd"?: string
    id?: string
    lines?: number
  }) => {
    switch (args.action ?? "list") {
      case "listen": {
        await startWebhookServer(args.port ?? 7890)
        break
      }

      case "list": {
        const configs = readConfigs()
        if (!configs.length) { console.log("No webhooks registered. Use `webhooks add`."); break }
        console.log("\n🪝 Webhooks:\n")
        for (const wh of configs) {
          const st = wh.enabled ? "🟢" : "⏸"
          console.log(`  ${st} ${wh.id}  ${wh.path}  [${wh.source}]  ${wh.name}`)
          if (wh.events.length) console.log(`       events: ${wh.events.join(", ")}`)
          if (wh.action) console.log(`       action: ${wh.action}`)
          console.log(`       hits: ${wh.hitCount ?? 0}`)
        }
        break
      }

      case "add": {
        if (!args.path) { console.error("Provide --path (e.g. /github)"); process.exit(1) }
        const wh: WebhookConfig = {
          id: randomUUID().slice(0, 8),
          path: args.path.startsWith("/") ? args.path : `/${args.path}`,
          name: args.name ?? args.path,
          source: (args.source ?? "custom") as WebhookConfig["source"],
          events: (args.events ?? []).map(String),
          action: args["action-cmd"],
          enabled: true,
          createdAt: Date.now(),
          hitCount: 0,
        }
        const configs = readConfigs()
        configs.push(wh)
        writeConfigs(configs)
        console.log(`✅ Webhook registered  id=${wh.id}  path=${wh.path}`)
        break
      }

      case "delete": {
        if (!args.id) { console.error("Provide --id"); process.exit(1) }
        writeConfigs(readConfigs().filter((c) => c.id !== args.id))
        console.log(`🗑 Webhook ${args.id} deleted.`)
        break
      }

      case "test": {
        if (!args.id) { console.error("Provide --id"); process.exit(1) }
        const wh = readConfigs().find((c) => c.id === args.id)
        if (!wh) { console.error(`Webhook ${args.id} not found`); process.exit(1) }
        const testPayload = { test: true, event: wh.events[0] ?? "test", ts: Date.now() }
        try {
          const http = require("http")
          const body = JSON.stringify(testPayload)
          const req = http.request({ host: "localhost", port: args.port ?? 7890, path: wh.path, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res: any) => {
            console.log(`Test delivered: ${res.statusCode}`)
          })
          req.write(body)
          req.end()
        } catch {
          console.error("Could not connect. Is the webhook server running? Use `webhooks listen`.")
        }
        break
      }

      case "logs": {
        const events = readEvents(args.lines ?? 30)
        if (!events.length) { console.log("No events."); break }
        for (const e of events) {
          const icon = e.status === "processed" ? "✅" : e.status === "error" ? "❌" : "📨"
          console.log(`  ${icon} ${new Date(e.ts).toLocaleString()}  ${e.source}/${e.event}  id=${e.id}`)
        }
        break
      }

      default:
        console.error(`Unknown action: ${args.action}`)
        process.exit(1)
    }
  },
})
