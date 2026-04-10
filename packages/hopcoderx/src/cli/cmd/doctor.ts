import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Global } from "../../global"
import { Installation } from "../../installation"
import { ModelsDev } from "../../provider/models"
import { Filesystem } from "../../util/filesystem"
import { Log } from "../../util/log"
import { ChannelRegistry } from "../../channels/channel"
import path from "path"
import { execSync } from "child_process"

type Status = "ok" | "warn" | "fail" | "skip"
interface Check {
  label: string
  status: Status
  detail?: string
  fix?: string
}

function icon(status: Status) {
  switch (status) {
    case "ok":
      return "\x1b[32m✓\x1b[0m"
    case "warn":
      return "\x1b[33m⚠\x1b[0m"
    case "fail":
      return "\x1b[31m✗\x1b[0m"
    case "skip":
      return "\x1b[2m–\x1b[0m"
  }
}

function printCheck(check: Check) {
  const line = `  ${icon(check.status)} ${check.label}`
  console.log(line)
  if (check.detail) console.log(`      \x1b[2m${check.detail}\x1b[0m`)
  if (check.fix) console.log(`      \x1b[33mFix:\x1b[0m ${check.fix}`)
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
  console.log("  " + "─".repeat(title.length + 2))
}

async function checkInstallation(): Promise<Check[]> {
  const checks: Check[] = []

  checks.push({
    label: `Version: ${Installation.VERSION}`,
    status: "ok",
    detail: `Installed at ${Installation.isLocal() ? "dev (local source)" : "binary"}`,
  })

  const logFile = Log.file()
  const logExists = logFile ? await Filesystem.exists(logFile) : false
  checks.push({
    label: "Log file",
    status: logExists ? "ok" : "warn",
    detail: logFile ?? "unknown",
    fix: logExists ? undefined : "Log file will be created on first run",
  })

  const dataDir = Global.Path.data
  const configDir = Global.Path.config
  const cacheDir = Global.Path.cache
  for (const [name, dir] of [
    ["Data dir", dataDir],
    ["Config dir", configDir],
    ["Cache dir", cacheDir],
  ] as const) {
    const exists = await Filesystem.exists(dir)
    checks.push({
      label: name,
      status: exists ? "ok" : "warn",
      detail: dir,
      fix: exists ? undefined : `mkdir -p "${dir}"`,
    })
  }

  return checks
}

async function checkProviders(): Promise<Check[]> {
  const checks: Check[] = []
  const config = await Config.get()

  let providerData: Record<string, ModelsDev.Provider> = {}
  try {
    providerData = await ModelsDev.get()
  } catch {
    checks.push({
      label: "models.dev registry",
      status: "warn",
      detail: "Could not fetch provider registry — working offline",
    })
    return checks
  }

  checks.push({
    label: `models.dev registry loaded (${Object.keys(providerData).length} providers)`,
    status: "ok",
  })

  const env = process.env as Record<string, string | undefined>
  const authAll = await Auth.all()
  const configured: string[] = []
  const missing: string[] = []

  for (const [id, provider] of Object.entries(providerData)) {
    const hasEnv = provider.env.some((e) => env[e])
    const hasAuth = !!authAll[id]
    const hasConfig = !!config.provider?.[id]?.options?.apiKey
    if (hasEnv || hasAuth || hasConfig) {
      configured.push(provider.name)
    } else if (provider.env.length > 0) {
      missing.push(provider.name)
    }
  }

  if (configured.length > 0) {
    checks.push({
      label: `Configured providers: ${configured.slice(0, 6).join(", ")}${configured.length > 6 ? ` +${configured.length - 6} more` : ""}`,
      status: "ok",
    })
  }

  if (missing.length > 0 && configured.length === 0) {
    checks.push({
      label: "No providers configured",
      status: "fail",
      detail: "HopCoderX needs at least one provider API key",
      fix: "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or run: hopcoderx auth",
    })
  }

  // Check active model
  const model = config.model
  if (model) {
    checks.push({ label: `Active model: ${model}`, status: "ok" })
  } else {
    checks.push({
      label: "No model configured",
      status: "warn",
      detail: "HopCoderX will use the first available model",
      fix: 'Add "model": "<provider>/<model-id>" to your hopcoderx.json',
    })
  }

  return checks
}

async function checkMCP(): Promise<Check[]> {
  const checks: Check[] = []
  const config = await Config.get()
  const mcpServers = config.mcp ?? {}
  const count = Object.keys(mcpServers).length

  if (count === 0) {
    checks.push({ label: "No MCP servers configured", status: "skip" })
    return checks
  }

  checks.push({ label: `${count} MCP server(s) configured`, status: "ok" })

  for (const [name, server] of Object.entries(mcpServers)) {
    if (typeof server !== "object" || server === null || !("type" in server)) {
      checks.push({ label: `MCP: ${name}`, status: "warn", detail: "Invalid config format" })
      continue
    }
    checks.push({ label: `MCP: ${name} (${(server as any).type})`, status: "ok" })
  }

  return checks
}

async function checkLSP(): Promise<Check[]> {
  const checks: Check[] = []
  const config = await Config.get()
  const lsp = config.lsp ?? {}
  const count = Object.keys(lsp).length

  if (count === 0) {
    checks.push({ label: "No LSP servers configured", status: "skip", detail: "LSP is optional" })
    return checks
  }

  checks.push({ label: `${count} LSP server(s) configured`, status: "ok" })

  // Check common LSP binaries
  const commonLSPs = [
    { name: "TypeScript (tsserver)", bin: "typescript-language-server" },
    { name: "Rust (rust-analyzer)", bin: "rust-analyzer" },
    { name: "Python (pylsp)", bin: "pylsp" },
    { name: "Go (gopls)", bin: "gopls" },
  ]

  for (const { name, bin } of commonLSPs) {
    try {
      execSync(`which ${bin} 2>/dev/null || where ${bin} 2>NUL`, { stdio: "pipe" })
      checks.push({ label: `LSP binary: ${name}`, status: "ok" })
    } catch {
      // Not installed — not an error unless configured
    }
  }

  return checks
}

async function checkGit(): Promise<Check[]> {
  const checks: Check[] = []

  try {
    const version = execSync("git --version 2>/dev/null || git --version 2>NUL", { stdio: "pipe" })
      .toString()
      .trim()
    checks.push({ label: `Git: ${version}`, status: "ok" })
  } catch {
    checks.push({
      label: "Git not found",
      status: "warn",
      detail: "Git is required for worktree, diff, and PR features",
      fix: "Install git from https://git-scm.com",
    })
  }

  return checks
}

async function checkDependencies(): Promise<Check[]> {
  const checks: Check[] = []

  // Check Bun version
  try {
    const version = process.versions.bun ?? "unknown"
    checks.push({ label: `Bun runtime: v${version}`, status: "ok" })
  } catch {
    checks.push({ label: "Bun version check failed", status: "warn" })
  }

  // Check Node.js if needed
  try {
    const nodeVersion = execSync("node --version 2>/dev/null || node --version 2>NUL", { stdio: "pipe" })
      .toString()
      .trim()
    checks.push({ label: `Node.js: ${nodeVersion}`, status: "ok" })
  } catch {
    checks.push({ label: "Node.js not found", status: "skip", detail: "Optional for some tools" })
  }

  // Check Docker (for sandbox)
  try {
    execSync("docker --version 2>/dev/null || docker --version 2>NUL", { stdio: "pipe" })
    checks.push({ label: "Docker: found", status: "ok", detail: "Sandboxed execution available" })
  } catch {
    checks.push({ label: "Docker: not found", status: "skip", detail: "Optional — enables sandboxed code execution" })
  }

  return checks
}

async function checkConfig(): Promise<Check[]> {
  const checks: Check[] = []

  try {
    const config = await Config.get()

    // Check config file exists
    const globalConfig = path.join(Global.Path.config, "hopcoderx.json")
    const globalConfigExists = await Filesystem.exists(globalConfig)
    checks.push({
      label: globalConfigExists ? "Global config found" : "No global config",
      status: globalConfigExists ? "ok" : "skip",
      detail: globalConfig,
      fix: globalConfigExists ? undefined : `Create ${globalConfig} to configure HopCoderX globally`,
    })

    // Check project config
    const projectConfig = path.join(process.cwd(), "hopcoderx.json")
    const projectConfigExists = await Filesystem.exists(projectConfig)
    checks.push({
      label: projectConfigExists ? "Project config found" : "No project config",
      status: projectConfigExists ? "ok" : "skip",
      detail: projectConfigExists ? projectConfig : "hopcoderx.json in current directory",
    })

    // Check instructions
    const instructions = config.instructions ?? []
    if (instructions.length > 0) {
      checks.push({ label: `Instructions: ${instructions.length} source(s) loaded`, status: "ok" })
    }

    // Check plugins
    const plugins = config.plugin ?? []
    if (plugins.length > 0) {
      checks.push({ label: `Plugins: ${plugins.join(", ")}`, status: "ok" })
    }
  } catch (e) {
    checks.push({
      label: "Config parse error",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
      fix: "Check your hopcoderx.json for syntax errors",
    })
  }

  return checks
}

async function runFixes(checks: Check[]) {
  const fixable = checks.filter((c) => c.status === "fail" && c.fix)
  if (fixable.length === 0) {
    console.log("\n\x1b[32m✓ No fixable issues found.\x1b[0m")
    return
  }
  console.log(`\n\x1b[33mAuto-fixing ${fixable.length} issue(s)...\x1b[0m`)
  for (const check of fixable) {
    console.log(`  → ${check.label}: ${check.fix}`)
    // Only execute safe, non-destructive fixes
    if (check.fix?.startsWith("mkdir")) {
      try {
        execSync(check.fix, { stdio: "pipe" })
        console.log(`    \x1b[32m✓ Fixed\x1b[0m`)
      } catch {
        console.log(`    \x1b[31m✗ Could not auto-fix — run manually\x1b[0m`)
      }
    }
  }
}

async function checkChannels(): Promise<Check[]> {
  const checks: Check[] = []
  // Dynamically load channel registrations (same as channels CLI)
  try {
    await import("../cmd/channels")
  } catch {}

  const all = ChannelRegistry.all()
  if (all.length === 0) {
    checks.push({ label: "Channel registry", status: "warn", detail: "No channels registered" })
    return checks
  }

  checks.push({
    label: `Channel registry`,
    status: "ok",
    detail: `${all.length} channel(s) registered`,
  })

  const results = await ChannelRegistry.diagnoseAll()
  for (const r of results) {
    const failing = r.checks?.filter((c) => !c.ok) ?? []
    checks.push({
      label: r.channelId,
      status: r.ok ? "ok" : failing.length > 0 ? "warn" : "skip",
      detail: r.summary,
    })
  }

  return checks
}

async function checkCanvas(): Promise<Check[]> {
  const port = Number(process.env.HOPCODERX_CANVAS_PORT ?? 3741)
  const url = `http://localhost:${port}/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const body = (await res.json()) as { ok?: boolean; clients?: number }
      return [
        {
          label: `Canvas host (port ${port})`,
          status: "ok",
          detail: `Running — ${body.clients ?? 0} WebSocket client(s) connected`,
        },
      ]
    }
    return [
      {
        label: `Canvas host (port ${port})`,
        status: "warn",
        detail: `Responded with status ${res.status}`,
        fix: "Run `hopcoderx daemon start` to launch the canvas host",
      },
    ]
  } catch {
    return [
      {
        label: `Canvas host (port ${port})`,
        status: "warn",
        detail: "Not reachable — canvas is non-functional",
        fix: "Run `hopcoderx daemon start` to launch the canvas host",
      },
    ]
  }
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "diagnose HopCoderX installation and configuration",
  builder: (yargs: Argv) =>
    yargs.option("fix", {
      describe: "attempt to automatically fix issues",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    console.log("\n\x1b[1mHopCoderX Doctor\x1b[0m — system health check\n")

    const allChecks: Check[] = []

    const groups: [string, () => Promise<Check[]>][] = [
      ["Installation", checkInstallation],
      ["Configuration", checkConfig],
      ["Providers & Models", checkProviders],
      ["MCP Servers", checkMCP],
      ["LSP", checkLSP],
      ["Dependencies", checkDependencies],
      ["Git", checkGit],
      ["Channels", checkChannels],
      ["Canvas Host", checkCanvas],
    ]

    for (const [title, fn] of groups) {
      section(title)
      let checks: Check[]
      try {
        checks = await fn()
      } catch (e) {
        checks = [
          {
            label: `${title} check failed`,
            status: "fail",
            detail: e instanceof Error ? e.message : String(e),
          },
        ]
      }
      for (const check of checks) {
        printCheck(check)
        allChecks.push(check)
      }
    }

    const fails = allChecks.filter((c) => c.status === "fail").length
    const warns = allChecks.filter((c) => c.status === "warn").length
    const oks = allChecks.filter((c) => c.status === "ok").length

    console.log("\n" + "─".repeat(50))
    if (fails === 0 && warns === 0) {
      console.log(`\x1b[32m✓ All checks passed (${oks} ok)\x1b[0m`)
    } else {
      console.log(
        `Summary: \x1b[32m${oks} ok\x1b[0m  \x1b[33m${warns} warn\x1b[0m  \x1b[31m${fails} fail\x1b[0m`,
      )
      if (fails > 0) {
        console.log("\x1b[31mSome checks failed. Run \x1b[1mhopcoderx doctor --fix\x1b[0m\x1b[31m to attempt repairs.\x1b[0m")
      }
    }
    console.log()

    if (args.fix) {
      await runFixes(allChecks)
    }

    if (fails > 0) process.exitCode = 1
  },
})
