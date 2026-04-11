/**
 * hopcoderx status — show all integrations, providers, memory, daemon, and recent sessions.
 * A comprehensive dashboard view of your HopCoderX installation.
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { execSync } from "child_process"
import { Instance } from "../../project/instance"
import { getInstallationSummary, getRuntimeSummary } from "../diagnostics"

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

function readVersion(command: string, prefix?: string) {
  try {
    const value = execSync(command, { stdio: "pipe" }).toString().trim()
    return prefix ? value.replace(prefix, "").trim() : value
  } catch {
    return undefined
  }
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
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const installation = await getInstallationSummary()
        const runtime = await getRuntimeSummary()
        const nodeVersion = readVersion("node --version 2>NUL || node --version 2>/dev/null")
        const bunVersion = process.versions.bun ? `v${process.versions.bun}` : undefined
        const gitVersion = readVersion("git --version 2>NUL || git --version 2>/dev/null", "git version ")
        const providerList = runtime.provider.providerList

        const statusData: Record<string, unknown> = {
          version: installation.version,
          dev: installation.dev,
          ready: providerList.length > 0,
          installation: {
            version: installation.version,
            dev: installation.dev,
            method: installation.method,
            launcherPath: installation.launcherPath,
            shimConflicts: installation.shimConflicts,
            logFile: installation.logFile,
            logExists: installation.logExists,
            directories: installation.directories,
          },
          providers: providerList,
          provider: runtime.provider,
          mcp: runtime.mcp,
          auth: runtime.auth,
          config: runtime.config,
          daemon: runtime.daemon,
          lsp: runtime.lsp,
          environment: {
            nodeVersion,
            bunVersion,
            gitVersion,
          },
        }

        // ── Core ────────────────────────────────────────────────────────
        if (!args.json) {
          header("HopCoderX")
          console.log(`  Version      ${cyan(installation.version)}`)
          console.log(`  Mode         ${installation.dev ? yellow("development") : green("production")}`)
          console.log(`  Method       ${cyan(installation.method)}`)
          console.log(`  Launcher     ${dim(installation.launcherPath)}`)
          console.log(`  Config dir   ${dim(Global.Path.config)}`)
          console.log(`  Data dir     ${dim(Global.Path.data)}`)
          if (installation.shimConflicts.length > 0) {
            for (const conflict of installation.shimConflicts) {
              console.log(`  ${yellow("⚠")}  Broken ${conflict.manager} shim: ${dim(conflict.shimPath)}`)
              console.log(`     ${dim(`Missing target: ${conflict.expectedTarget}`)}`)
            }
          }
        }

        // ── Providers ───────────────────────────────────────────────────
        if (!args.json) {
          header("Providers")
          if (providerList.length === 0) {
            console.log(`  ${yellow("⚠")}  No providers configured — run ${bold("hopcoderx auth")} or set an API key`)
          } else {
            for (const info of providerList) {
              console.log(
                `  ${green("●")}  ${bold(info.id)} ${dim(`(${info.source})`)} — ${info.models} model${info.models !== 1 ? "s" : ""}`,
              )
            }
          }
          const model = runtime.provider.activeModel
          console.log(`\n  Active model  ${model ? cyan(model) : dim("(auto)")}`)

          if (runtime.provider.failover.length > 0) {
            console.log(`  Failover      ${runtime.provider.failover.join(dim(" → "))}`)
          }
        }

        // ── MCP Servers ─────────────────────────────────────────────────
        if (!args.json) {
          header("MCP Servers")
          if (runtime.mcp.count === 0) {
            console.log(`  ${dim("○")}  No MCP servers configured`)
          } else {
            for (const server of runtime.mcp.servers) {
              console.log(`  ${green("●")}  ${bold(server.name)} ${dim(`(${server.type})`)}`)
            }
          }
        }

        // ── Auth / API Keys ─────────────────────────────────────────────
        if (!args.json) {
          header("Authentication")
          if (runtime.auth.count === 0) {
            console.log(`  ${dim("○")}  No API keys stored`)
          } else {
            for (const entry of runtime.auth.entries) {
              console.log(`  ${green("●")}  ${bold(entry.provider)} ${dim(`(${entry.type})`)}`)
            }
          }
        }

        // ── Config ──────────────────────────────────────────────────────
        if (!args.json) {
          header("Configuration")
          console.log(`  Global  ${statusBadge(runtime.config.globalExists)} ${dim(runtime.config.globalConfigPath)}`)
          console.log(`  Project ${statusBadge(runtime.config.projectExists)} ${dim(runtime.config.projectConfigPath)}`)

          if (runtime.config.plugins.length > 0) {
            console.log(`  Plugins: ${runtime.config.plugins.join(", ")}`)
          }

          if (runtime.config.instructionsCount > 0) {
            console.log(`  Instructions: ${runtime.config.instructionsCount} source(s)`)
          }
        }

        // ── Daemon / Background service ─────────────────────────────────
        if (!args.json) {
          header("Background Services")
          console.log(
            `  Daemon  ${statusBadge(runtime.daemon.running)}${runtime.daemon.running ? "" : dim(" — start with: hopcoderx serve")}`,
          )
        }

        // ── Git ─────────────────────────────────────────────────────────
        if (!args.json) {
          header("Environment")
          if (nodeVersion) console.log(`  Node.js  ${green(nodeVersion)}`)
          if (bunVersion) console.log(`  Bun      ${green(bunVersion)}`)
          console.log(`  Git      ${gitVersion ? green(gitVersion) : red("not found")}`)
        }

        // ── Summary ─────────────────────────────────────────────────────
        if (args.json) {
          console.log(JSON.stringify(statusData, null, 2))
          return
        }

        console.log()
        if (providerList.length === 0) {
          console.log(
            yellow("⚠  No providers configured. Run: ") + bold("hopcoderx onboard") + yellow(" to get started."),
          )
        } else {
          console.log(green("✓  Ready") + dim(` — ${providerList.length} provider(s) active`))
        }
        console.log()
      },
    })
  },
})
