/**
 * hopcoderx status — show all integrations, providers, memory, daemon, and recent sessions.
 * A comprehensive dashboard view of your HopCoderX installation.
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { Auth } from "../../auth"
import { Global } from "../../global"
import { Installation } from "../../installation"
import { Filesystem } from "../../util/filesystem"
import path from "path"
import { execSync } from "child_process"

function bold(s: string) { return `\x1b[1m${s}\x1b[0m` }
function green(s: string) { return `\x1b[32m${s}\x1b[0m` }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m` }
function red(s: string) { return `\x1b[31m${s}\x1b[0m` }
function dim(s: string) { return `\x1b[2m${s}\x1b[0m` }
function cyan(s: string) { return `\x1b[36m${s}\x1b[0m` }

function statusBadge(ok: boolean, label?: string) {
  return ok ? green("● " + (label ?? "active")) : dim("○ " + (label ?? "inactive"))
}

function header(title: string) {
  const line = "─".repeat(Math.max(0, 44 - title.length))
  console.log(`\n${bold(title)} ${dim(line)}`)
}

export const StatusCommand = cmd({
  command: "status",
  describe: "show status of all HopCoderX integrations and services",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      describe: "output as JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const config = await Config.get()
    const authAll = await Auth.all()
    const env = process.env as Record<string, string | undefined>

    const statusData: Record<string, unknown> = {}

    // ── Core ────────────────────────────────────────────────────────
    header("HopCoderX")
    console.log(`  Version      ${cyan(Installation.VERSION)}`)
    console.log(`  Mode         ${Installation.isLocal() ? yellow("development") : green("production")}`)
    console.log(`  Config dir   ${dim(Global.Path.config)}`)
    console.log(`  Data dir     ${dim(Global.Path.data)}`)

    statusData.version = Installation.VERSION
    statusData.dev = Installation.isLocal()

    // ── Providers ───────────────────────────────────────────────────
    header("Providers")
    let providers: Awaited<ReturnType<typeof Provider.list>> = {}
    try {
      providers = await Provider.list()
    } catch { /* not in instance context */ }

    const providerList = Object.entries(providers)
    if (providerList.length === 0) {
      console.log(`  ${yellow("⚠")}  No providers configured — run ${bold("hopcoderx auth")} or set an API key`)
    } else {
      for (const [id, info] of providerList) {
        const modelCount = Object.keys(info.models).length
        console.log(`  ${green("●")}  ${bold(id)} ${dim(`(${info.source})`)} — ${modelCount} model${modelCount !== 1 ? "s" : ""}`)
      }
    }
    statusData.providers = providerList.map(([id, info]) => ({ id, source: info.source, models: Object.keys(info.models).length }))

    // Active model
    const model = config.model
    console.log(`\n  Active model  ${model ? cyan(model) : dim("(auto)")}`)

    // ── Failover chain ──────────────────────────────────────────────
    const failover = (config as any).provider_failover as string[] | undefined
    if (failover?.length) {
      console.log(`  Failover      ${failover.join(dim(" → "))}`)
    }

    // ── MCP Servers ─────────────────────────────────────────────────
    header("MCP Servers")
    const mcpServers = config.mcp ?? {}
    const mcpCount = Object.keys(mcpServers).length
    if (mcpCount === 0) {
      console.log(`  ${dim("○")}  No MCP servers configured`)
    } else {
      for (const [name, server] of Object.entries(mcpServers)) {
        const type = typeof server === "object" && server && "type" in server ? (server as any).type : "?"
        console.log(`  ${green("●")}  ${bold(name)} ${dim(`(${type})`)}`)
      }
    }
    statusData.mcp = { count: mcpCount }

    // ── Auth / API Keys ─────────────────────────────────────────────
    header("Authentication")
    const authCount = Object.keys(authAll).length
    if (authCount === 0) {
      console.log(`  ${dim("○")}  No API keys stored`)
    } else {
      for (const [provider, info] of Object.entries(authAll)) {
        const type = (info as any).type === "oauth" ? "OAuth" : "API key"
        console.log(`  ${green("●")}  ${bold(provider)} ${dim(`(${type})`)}`)
      }
    }
    statusData.auth = { count: authCount }

    // ── Config ──────────────────────────────────────────────────────
    header("Configuration")
    const globalConfig = path.join(Global.Path.config, "hopcoderx.json")
    const projectConfig = path.join(process.cwd(), "hopcoderx.json")
    const globalExists = await Filesystem.exists(globalConfig)
    const projectExists = await Filesystem.exists(projectConfig)

    console.log(`  Global  ${statusBadge(globalExists)} ${dim(globalConfig)}`)
    console.log(`  Project ${statusBadge(projectExists)} ${dim(projectConfig)}`)

    const plugins = config.plugin ?? []
    if (plugins.length > 0) {
      console.log(`  Plugins: ${plugins.join(", ")}`)
    }

    const instructions = config.instructions ?? []
    if (instructions.length > 0) {
      console.log(`  Instructions: ${instructions.length} source(s)`)
    }

    // ── Daemon / Background service ─────────────────────────────────
    header("Background Services")
    const daemonPidFile = path.join(Global.Path.state, "daemon.pid")
    const daemonRunning = await Filesystem.exists(daemonPidFile)
    console.log(`  Daemon  ${statusBadge(daemonRunning)}${daemonRunning ? "" : dim(" — start with: hopcoderx serve")}`)
    statusData.daemon = { running: daemonRunning }

    // ── Git ─────────────────────────────────────────────────────────
    header("Environment")
    try {
      const nodeVer = execSync("node --version 2>NUL || node --version 2>/dev/null", { stdio: "pipe" }).toString().trim()
      console.log(`  Node.js  ${green(nodeVer)}`)
    } catch { }

    const bunVer = process.versions.bun
    if (bunVer) console.log(`  Bun      ${green("v" + bunVer)}`)

    try {
      const gitVer = execSync("git --version 2>NUL || git --version 2>/dev/null", { stdio: "pipe" })
        .toString()
        .replace("git version ", "")
        .trim()
      console.log(`  Git      ${green(gitVer)}`)
    } catch {
      console.log(`  Git      ${red("not found")}`)
    }

    // ── Summary ─────────────────────────────────────────────────────
    console.log()
    if (providerList.length === 0) {
      console.log(yellow("⚠  No providers configured. Run: ") + bold("hopcoderx onboard") + yellow(" to get started."))
    } else {
      console.log(green("✓  Ready") + dim(` — ${providerList.length} provider(s) active`))
    }
    console.log()

    if (args.json) {
      console.log(JSON.stringify(statusData, null, 2))
    }
  },
})
