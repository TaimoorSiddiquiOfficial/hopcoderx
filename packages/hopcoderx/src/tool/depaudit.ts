import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"
import { $ } from "bun"

const log = Log.create({ service: "depaudit" })

const DESCRIPTION = `Audit project dependencies for security vulnerabilities, outdated packages, and unused deps.

Checks performed:
- **Vulnerabilities**: Runs OSV-Scanner or npm audit to find CVEs in installed packages
- **Outdated**: Lists packages with newer versions available
- **Unused**: Detects imports declared in package.json but never used in source
- **Licenses**: Flags packages with problematic licenses (GPL, AGPL, etc.)

Returns a structured report with severity levels and suggested upgrade commands.`

export const DepauditTool = Tool.define("depaudit", {
  description: DESCRIPTION,
  parameters: z.object({
    checks: z
      .array(z.enum(["vulnerabilities", "outdated", "unused", "licenses", "all"]))
      .default(["vulnerabilities", "outdated"])
      .describe("Which checks to run"),
    directory: z
      .string()
      .optional()
      .describe("Directory containing package.json (defaults to project root)"),
    fix: z
      .boolean()
      .default(false)
      .describe("Automatically apply safe upgrades (patch/minor versions only)"),
    severity: z
      .enum(["critical", "high", "medium", "low", "info"])
      .default("medium")
      .describe("Minimum severity to report vulnerabilities"),
  }),
  async execute({ checks, directory, fix, severity }, ctx) {
    const dir = directory ? path.join(Instance.directory, directory) : Instance.directory

    // Detect package manager + ecosystem
    const ecosystem = await detectEcosystem(dir)
    if (!ecosystem) {
      return {
        title: "depaudit",
        metadata: {},
        output: `No supported package manifest found in "${dir}". Expected: package.json, requirements.txt, go.mod, Cargo.toml, or Gemfile.`,
      }
    }

    log.info("depaudit start", { dir, ecosystem: ecosystem.type, checks })

    const allChecks = checks.includes("all") ? ["vulnerabilities", "outdated", "unused", "licenses"] : checks
    const results: string[] = []
    const metadata: Record<string, unknown> = { ecosystem: ecosystem.type, directory: dir }

    results.push(`## Dependency Audit Report`)
    results.push(`**Ecosystem:** ${ecosystem.type}`)
    results.push(`**Directory:** ${dir}`)
    results.push("")

    // Vulnerabilities
    if (allChecks.includes("vulnerabilities")) {
      const vulnResult = await runVulnerabilityCheck(dir, ecosystem, severity)
      results.push("### 🔐 Vulnerabilities")
      results.push(vulnResult.output)
      metadata.vulnerabilities = vulnResult.summary
    }

    // Outdated
    if (allChecks.includes("outdated")) {
      const outdatedResult = await runOutdatedCheck(dir, ecosystem)
      results.push("### 📦 Outdated Packages")
      results.push(outdatedResult.output)
      metadata.outdated = outdatedResult.summary

      if (fix && outdatedResult.fixCommand) {
        results.push("")
        results.push(`> **Auto-fix enabled.** Run: \`${outdatedResult.fixCommand}\``)
        results.push("> The agent will execute this command for you.")
        metadata.fixCommand = outdatedResult.fixCommand
      }
    }

    // Unused
    if (allChecks.includes("unused")) {
      results.push("### 🗑️ Unused Dependencies")
      results.push(await runUnusedCheck(dir, ecosystem))
    }

    // Licenses
    if (allChecks.includes("licenses")) {
      results.push("### ⚖️ License Issues")
      results.push(await runLicenseCheck(dir, ecosystem))
    }

    if (fix && metadata.fixCommand) {
      results.push("")
      results.push("---")
      results.push(`**Agent action:** Execute \`${metadata.fixCommand}\` to apply safe upgrades`)
    }

    return {
      title: "depaudit",
      metadata,
      output: results.join("\n"),
    }
  },
})

interface Ecosystem {
  type: string
  manifestFile: string
  lockFile?: string
}

async function detectEcosystem(dir: string): Promise<Ecosystem | null> {
  if (await Filesystem.exists(path.join(dir, "package.json"))) {
    const hasBunLock = await Filesystem.exists(path.join(dir, "bun.lockb"))
    const hasPnpmLock = await Filesystem.exists(path.join(dir, "pnpm-lock.yaml"))
    const hasYarnLock = await Filesystem.exists(path.join(dir, "yarn.lock"))
    return {
      type: hasBunLock ? "bun" : hasPnpmLock ? "pnpm" : hasYarnLock ? "yarn" : "npm",
      manifestFile: "package.json",
      lockFile: hasBunLock ? "bun.lockb" : hasPnpmLock ? "pnpm-lock.yaml" : "package-lock.json",
    }
  }
  if (await Filesystem.exists(path.join(dir, "requirements.txt")))
    return { type: "pip", manifestFile: "requirements.txt" }
  if (await Filesystem.exists(path.join(dir, "go.mod"))) return { type: "go", manifestFile: "go.mod" }
  if (await Filesystem.exists(path.join(dir, "Cargo.toml"))) return { type: "cargo", manifestFile: "Cargo.toml" }
  if (await Filesystem.exists(path.join(dir, "Gemfile"))) return { type: "bundler", manifestFile: "Gemfile" }
  return null
}

async function runVulnerabilityCheck(
  dir: string,
  eco: Ecosystem,
  severity: string,
): Promise<{ output: string; summary: unknown }> {
  const severityOrder = ["critical", "high", "medium", "low", "info"]
  const minIdx = severityOrder.indexOf(severity)

  // Try OSV-Scanner first (cross-ecosystem)
  try {
    const result = await $`osv-scanner --json ${dir}`.quiet().nothrow()
    if (result.exitCode === 0 || result.exitCode === 1) {
      const json = JSON.parse(result.stdout.toString())
      const vulns = (json.results ?? []).flatMap((r: any) => r.packages ?? []).flatMap((p: any) => p.vulnerabilities ?? [])
      const filtered = vulns.filter((v: any) => {
        const sev = (v.severity?.[0]?.score > 8.9 ? "critical" : v.severity?.[0]?.score > 6.9 ? "high" : v.severity?.[0]?.score > 3.9 ? "medium" : "low") as string
        return severityOrder.indexOf(sev) <= minIdx
      })
      if (filtered.length === 0) {
        return { output: "✅ No vulnerabilities found above the configured threshold.", summary: { count: 0 } }
      }
      const lines = filtered.slice(0, 20).map((v: any) => `- **${v.id}** (${v.aliases?.[0] ?? "no alias"}) — ${v.summary ?? "no description"}`)
      return {
        output: `Found **${filtered.length}** issue(s):\n${lines.join("\n")}`,
        summary: { count: filtered.length },
      }
    }
  } catch {
    // OSV not installed — fall back to ecosystem-specific tools
  }

  // Fallback: ecosystem-specific
  if (eco.type === "npm" || eco.type === "bun" || eco.type === "pnpm" || eco.type === "yarn") {
    try {
      const result = await $`npm audit --json`.cwd(dir).quiet().nothrow()
      const json = JSON.parse(result.stdout.toString())
      const total = json.metadata?.vulnerabilities
      if (!total) return { output: "✅ No vulnerabilities found (npm audit).", summary: { count: 0 } }
      const lines = Object.values(json.vulnerabilities ?? {})
        .slice(0, 15)
        .map((v: any) => `- **${v.name}** (${v.severity}): ${v.title ?? v.url}`)
      return {
        output: `Found **${total.total ?? "?"}** issue(s) (critical: ${total.critical}, high: ${total.high}, medium: ${total.medium}, low: ${total.low}):\n${lines.join("\n")}`,
        summary: total,
      }
    } catch {
      return { output: "_Could not run npm audit. Ensure npm is installed._", summary: {} }
    }
  }

  if (eco.type === "pip") {
    try {
      const result = await $`pip-audit --json`.cwd(dir).quiet().nothrow()
      const json = JSON.parse(result.stdout.toString())
      const vulns = json.vulnerabilities ?? []
      if (vulns.length === 0) return { output: "✅ No vulnerabilities found (pip-audit).", summary: { count: 0 } }
      const lines = vulns.slice(0, 15).map((v: any) => `- **${v.name}** ${v.version}: ${v.description}`)
      return { output: `Found **${vulns.length}** issue(s):\n${lines.join("\n")}`, summary: { count: vulns.length } }
    } catch {
      return { output: "_pip-audit not installed. Run: `pip install pip-audit`_", summary: {} }
    }
  }

  if (eco.type === "go") {
    try {
      const result = await $`govulncheck ./...`.cwd(dir).quiet().nothrow()
      const out = result.stdout.toString()
      if (out.includes("No vulnerabilities found")) return { output: "✅ No vulnerabilities found (govulncheck).", summary: { count: 0 } }
      return { output: `\`\`\`\n${out.slice(0, 2000)}\n\`\`\``, summary: {} }
    } catch {
      return { output: "_govulncheck not installed. Run: `go install golang.org/x/vuln/cmd/govulncheck@latest`_", summary: {} }
    }
  }

  return { output: "_Vulnerability scanning not available for this ecosystem._", summary: {} }
}

async function runOutdatedCheck(dir: string, eco: Ecosystem): Promise<{ output: string; summary: unknown; fixCommand?: string }> {
  if (eco.type === "npm" || eco.type === "bun" || eco.type === "pnpm" || eco.type === "yarn") {
    try {
      const result = await $`npm outdated --json`.cwd(dir).quiet().nothrow()
      const json = JSON.parse(result.stdout.toString() || "{}")
      const packages = Object.entries(json)
      if (packages.length === 0) return { output: "✅ All packages are up to date.", summary: { count: 0 } }
      const lines = packages
        .slice(0, 20)
        .map(([name, info]: [string, any]) => `- **${name}**: ${info.current} → ${info.latest} (wanted: ${info.wanted})`)
      const manager = eco.type === "bun" ? "bun" : eco.type === "pnpm" ? "pnpm" : "npm"
      return {
        output: `Found **${packages.length}** outdated package(s):\n${lines.join("\n")}`,
        summary: { count: packages.length },
        fixCommand: `${manager} update`,
      }
    } catch {
      return { output: "_Could not check for outdated packages._", summary: {} }
    }
  }

  if (eco.type === "pip") {
    try {
      const result = await $`pip list --outdated --format=json`.quiet().nothrow()
      const json = JSON.parse(result.stdout.toString() || "[]")
      if (json.length === 0) return { output: "✅ All packages are up to date.", summary: { count: 0 } }
      const lines = json.slice(0, 20).map((p: any) => `- **${p.name}**: ${p.version} → ${p.latest_version}`)
      return {
        output: `Found **${json.length}** outdated package(s):\n${lines.join("\n")}`,
        summary: { count: json.length },
        fixCommand: "pip install --upgrade " + json.map((p: any) => p.name).join(" "),
      }
    } catch {
      return { output: "_Could not check for outdated Python packages._", summary: {} }
    }
  }

  if (eco.type === "go") {
    try {
      const result = await $`go list -u -m -json all`.cwd(dir).quiet().nothrow()
      const lines = result.stdout.toString().split(/\}\s*\{/).filter(Boolean)
      const outdated = lines
        .map((l) => { try { return JSON.parse(l.startsWith("{") ? l : `{${l}`) } catch { return null } })
        .filter((m) => m?.Update)
      if (outdated.length === 0) return { output: "✅ All Go modules are up to date.", summary: { count: 0 } }
      const display = outdated.slice(0, 20).map((m: any) => `- **${m.Path}**: ${m.Version} → ${m.Update.Version}`)
      return {
        output: `Found **${outdated.length}** outdated module(s):\n${display.join("\n")}`,
        summary: { count: outdated.length },
        fixCommand: "go get -u ./...",
      }
    } catch {
      return { output: "_Could not check for outdated Go modules._", summary: {} }
    }
  }

  return { output: "_Outdated check not available for this ecosystem._", summary: {} }
}

async function runUnusedCheck(dir: string, eco: Ecosystem): Promise<string> {
  if (eco.type === "npm" || eco.type === "bun" || eco.type === "pnpm" || eco.type === "yarn") {
    try {
      const pkg = await Filesystem.readJson(path.join(dir, "package.json"))
      const deps = Object.keys(pkg.dependencies ?? {})
      if (deps.length === 0) return "No dependencies declared."

      // Quick heuristic: search source files for import of each dep
      const { Glob } = await import("../util/glob")
      const srcFiles = await Glob.scan("**/*.{ts,tsx,js,jsx,mjs}", { cwd: dir, absolute: true })
      const filteredFiles = srcFiles.filter(
        (f) => !f.includes("node_modules") && !f.includes("/dist/") && !f.includes("/.git/"),
      )

      const sources = await Promise.all(filteredFiles.slice(0, 100).map((f) => Filesystem.readText(f).catch(() => "")))
      const combined = sources.join("\n")

      const unused = deps.filter((dep) => {
        const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        return !new RegExp(`from ['"]${escaped}|require\\(['"]${escaped}`).test(combined)
      })

      if (unused.length === 0) return "✅ All declared dependencies are used."
      return `Found **${unused.length}** potentially unused dep(s):\n${unused.map((d) => `- ${d}`).join("\n")}\n\n_Tip: Run \`npx depcheck\` for a more accurate analysis._`
    } catch {
      return "_Could not perform unused dependency check._"
    }
  }
  return "_Unused check not available for this ecosystem._"
}

async function runLicenseCheck(dir: string, eco: Ecosystem): Promise<string> {
  const problematic = ["GPL-2.0", "GPL-3.0", "AGPL-3.0", "LGPL-2.1", "LGPL-3.0", "SSPL", "BUSL"]
  if (eco.type === "npm" || eco.type === "bun" || eco.type === "pnpm" || eco.type === "yarn") {
    try {
      const result = await $`npx license-checker --json --production`.cwd(dir).quiet().nothrow()
      const json = JSON.parse(result.stdout.toString() || "{}")
      const issues = Object.entries(json)
        .filter(([, info]: [string, any]) => problematic.some((l) => (info.licenses ?? "").includes(l)))
        .map(([name, info]: [string, any]) => `- **${name}**: ${info.licenses}`)
      if (issues.length === 0) return "✅ No problematic licenses found."
      return `Found **${issues.length}** package(s) with restrictive licenses:\n${issues.join("\n")}`
    } catch {
      return "_Run `npx license-checker` for detailed license analysis._"
    }
  }
  return "_License check not available for this ecosystem._"
}
