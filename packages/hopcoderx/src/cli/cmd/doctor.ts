import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Installation } from "../../installation"
import { ChannelRegistry } from "../../channels/channel"
import path from "path"
import { execSync } from "child_process"
import { Instance } from "../../project/instance"
import { getInstallationSummary, getRuntimeSummary } from "../diagnostics"

type Status = "ok" | "warn" | "fail" | "skip"
interface Check {
  label: string
  status: Status
  detail?: string
  fix?: string
  repair?: () => Promise<void> | void
}

type CheckGroup = {
  title: string
  checks: Check[]
}

type SerializedCheck = Omit<Check, "repair">

function serializeCheck(check: Check): SerializedCheck {
  return {
    label: check.label,
    status: check.status,
    detail: check.detail,
    fix: check.fix,
  }
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
  const summary = await getInstallationSummary()

  checks.push({
    label: `Version: ${summary.version}`,
    status: "ok",
    detail: `Installed at ${summary.dev ? "dev (local source)" : "binary"}`,
  })
  checks.push({
    label: `Install method: ${summary.method}`,
    status: "ok",
    detail: summary.launcherPath,
  })

  for (const conflict of summary.shimConflicts) {
    checks.push({
      label: "Broken Bun shim detected",
      status: "warn",
      detail: `${conflict.shimPath} -> missing ${conflict.expectedTarget}`,
      fix: conflict.fix,
      repair: async () => {
        const removed = Installation.repairShimConflicts([conflict])
        if (removed.length === 0) throw new Error("No stale shim files were removed")
      },
    })
  }

  checks.push({
    label: "Log file",
    status: summary.logExists ? "ok" : "warn",
    detail: summary.logFile ?? "unknown",
    fix: summary.logExists ? undefined : "Log file will be created on first run",
  })

  for (const dir of summary.directories) {
    checks.push({
      label: dir.label,
      status: dir.exists ? "ok" : "warn",
      detail: dir.path,
      fix: dir.exists ? undefined : `mkdir -p "${dir.path}"`,
    })
  }

  return checks
}

async function checkProviders(): Promise<Check[]> {
  const checks: Check[] = []
  const summary = await getRuntimeSummary()

  if (!summary.provider.registryLoaded) {
    checks.push({
      label: "models.dev registry",
      status: "warn",
      detail: "Could not fetch provider registry — working offline",
    })
    return checks
  }

  checks.push({
    label: `models.dev registry loaded (${summary.provider.registryCount} providers)`,
    status: "ok",
  })

  if (summary.provider.configuredProviderNames.length > 0) {
    checks.push({
      label: `Configured providers: ${summary.provider.configuredProviderNames.slice(0, 6).join(", ")}${summary.provider.configuredProviderNames.length > 6 ? ` +${summary.provider.configuredProviderNames.length - 6} more` : ""}`,
      status: "ok",
    })
  }

  if (summary.provider.missingProviderNames.length > 0 && summary.provider.configuredProviderNames.length === 0) {
    checks.push({
      label: "No providers configured",
      status: "fail",
      detail: "HopCoderX needs at least one provider API key",
      fix: "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or run: hopcoderx auth",
    })
  }

  // Check active model
  const model = summary.provider.activeModel
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
  const summary = await getRuntimeSummary()
  const count = summary.mcp.count

  if (count === 0) {
    checks.push({ label: "No MCP servers configured or active", status: "skip" })
    return checks
  }

  checks.push({
    label: `${count} MCP server(s) discovered`,
    status: summary.mcp.failedCount > 0 ? "warn" : "ok",
    detail:
      summary.mcp.connectedCount === count
        ? `${summary.mcp.connectedCount} connected`
        : `${summary.mcp.connectedCount} connected, ${summary.mcp.needsAuthCount} need auth, ${summary.mcp.failedCount} failed`,
  })

  for (const server of summary.mcp.servers) {
    if (!server.valid) {
      checks.push({ label: `MCP: ${server.name}`, status: "warn", detail: "Invalid config format" })
      continue
    }
    if (server.status === "connected") {
      checks.push({ label: `MCP: ${server.name} (${server.type})`, status: "ok" })
      continue
    }

    if (server.status === "needs_auth") {
      checks.push({
        label: `MCP: ${server.name} (${server.type})`,
        status: "warn",
        detail: "Authentication required",
        fix: `Run: hopcoderx mcp auth ${server.name}`,
      })
      continue
    }

    if (server.status === "needs_client_registration") {
      checks.push({
        label: `MCP: ${server.name} (${server.type})`,
        status: "warn",
        detail: server.error ?? "Client registration required",
      })
      continue
    }

    if (server.status === "failed") {
      checks.push({
        label: `MCP: ${server.name} (${server.type})`,
        status: "warn",
        detail: server.error ?? "Connection failed",
        fix: server.hint,
      })
      continue
    }

    checks.push({
      label: `MCP: ${server.name} (${server.type})`,
      status: "skip",
      detail: server.builtin ? "Built-in server is not active for this project" : "Configured but disabled",
    })
  }

  return checks
}

async function checkLSP(): Promise<Check[]> {
  const checks: Check[] = []
  const summary = await getRuntimeSummary()
  const count = summary.lsp.count

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
    const summary = await getRuntimeSummary()

    // Check config file exists
    checks.push({
      label: summary.config.globalExists ? "Global config found" : "No global config",
      status: summary.config.globalExists ? "ok" : "skip",
      detail: summary.config.globalConfigPath,
      fix: summary.config.globalExists ? undefined : `Create ${summary.config.globalConfigPath} to configure HopCoderX globally`,
    })

    // Check project config
    checks.push({
      label: summary.config.projectExists ? "Project config found" : "No project config",
      status: summary.config.projectExists ? "ok" : "skip",
      detail: summary.config.projectExists ? summary.config.projectConfigPath : "hopcoderx.json in current directory",
    })

    // Check instructions
    if (summary.config.instructionsCount > 0) {
      checks.push({ label: `Instructions: ${summary.config.instructionsCount} source(s) loaded`, status: "ok" })
    }

    // Check plugins
    if (summary.config.plugins.length > 0) {
      checks.push({ label: `Plugins: ${summary.config.plugins.join(", ")}`, status: "ok" })
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

async function runFixes(checks: Check[], options?: { quiet?: boolean }) {
  const fixable = checks.filter(
    (c) => (c.status === "fail" || c.status === "warn") && (c.repair || c.fix?.startsWith("mkdir")),
  )
  const results: Array<{ label: string; fixed: boolean }> = []
  if (fixable.length === 0) {
    if (!options?.quiet) console.log("\n\x1b[32m✓ No fixable issues found.\x1b[0m")
    return results
  }
  if (!options?.quiet) console.log(`\n\x1b[33mAuto-fixing ${fixable.length} issue(s)...\x1b[0m`)
  for (const check of fixable) {
    if (!options?.quiet) console.log(`  → ${check.label}: ${check.fix}`)
    if (check.repair) {
      try {
        await check.repair()
        if (!options?.quiet) console.log(`    \x1b[32m✓ Fixed\x1b[0m`)
        results.push({ label: check.label, fixed: true })
      } catch {
        if (!options?.quiet) console.log(`    \x1b[31m✗ Could not auto-fix — run manually\x1b[0m`)
        results.push({ label: check.label, fixed: false })
      }
      continue
    }
    // Only execute safe, non-destructive fixes
    if (check.fix?.startsWith("mkdir")) {
      try {
        execSync(check.fix, { stdio: "pipe" })
        if (!options?.quiet) console.log(`    \x1b[32m✓ Fixed\x1b[0m`)
        results.push({ label: check.label, fixed: true })
      } catch {
        if (!options?.quiet) console.log(`    \x1b[31m✗ Could not auto-fix — run manually\x1b[0m`)
        results.push({ label: check.label, fixed: false })
      }
    }
  }
  return results
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
    yargs
      .option("fix", {
        describe: "attempt to automatically fix issues",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "output diagnostic results as JSON",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const allChecks: Check[] = []
        const groupsOutput: CheckGroup[] = []

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

        if (!args.json) console.log("\n\x1b[1mHopCoderX Doctor\x1b[0m — system health check\n")

        for (const [title, fn] of groups) {
          if (!args.json) section(title)
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
          groupsOutput.push({ title, checks })
          for (const check of checks) {
            if (!args.json) printCheck(check)
            allChecks.push(check)
          }
        }

        const fails = allChecks.filter((c) => c.status === "fail").length
        const warns = allChecks.filter((c) => c.status === "warn").length
        const oks = allChecks.filter((c) => c.status === "ok").length
        const skips = allChecks.filter((c) => c.status === "skip").length

        if (!args.json) {
          console.log("\n" + "─".repeat(50))
          if (fails === 0 && warns === 0) {
            console.log(`\x1b[32m✓ All checks passed (${oks} ok)\x1b[0m`)
          } else {
            console.log(
              `Summary: \x1b[32m${oks} ok\x1b[0m  \x1b[33m${warns} warn\x1b[0m  \x1b[31m${fails} fail\x1b[0m`,
            )
            if (fails > 0) {
              console.log(
                "\x1b[31mSome checks failed. Run \x1b[1mhopcoderx doctor --fix\x1b[0m\x1b[31m to attempt repairs.\x1b[0m",
              )
            }
          }
          console.log()
        }

        const fixes = args.fix ? await runFixes(allChecks, { quiet: args.json }) : []
        if (args.fix) {
          // runFixes already executed above
        }

        if (args.json) {
          console.log(
            JSON.stringify(
              {
                summary: {
                  ok: oks,
                  warn: warns,
                  fail: fails,
                  skip: skips,
                },
                groups: groupsOutput.map((group) => ({
                  title: group.title,
                  checks: group.checks.map(serializeCheck),
                })),
                fixes,
              },
              null,
              2,
            ),
          )
        }

        if (fails > 0) process.exitCode = 1
      },
    })
  },
})
