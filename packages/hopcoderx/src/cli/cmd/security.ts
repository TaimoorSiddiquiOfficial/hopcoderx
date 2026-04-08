import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as pc from "@clack/prompts"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import path from "path"
import { $ } from "bun"

interface AuditFinding {
  severity: "critical" | "high" | "medium" | "low" | "info"
  category: string
  title: string
  detail: string
  fix?: string
}

export const SecurityCommand = cmd({
  command: "security <action>",
  describe: "Security audit and hardening for HopCoderX",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        choices: ["audit", "scan", "report"] as const,
        describe: "Action to perform",
      })
      .option("deep", {
        type: "boolean",
        default: false,
        describe: "Enable deep scanning (slower, more thorough)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output as JSON",
      })
      .option("fix", {
        type: "boolean",
        default: false,
        describe: "Auto-fix safe issues",
      }),
  handler: async (args: { action?: string; deep?: boolean; fix?: boolean; json?: boolean }) => {
    const action = args.action
    if (action === "audit") return runAudit(args.deep ?? false, args.fix ?? false, args.json ?? false)
    if (action === "scan") return runCodeScan(args.deep ?? false, args.json ?? false)
    if (action === "report") return runReport()
  },
})

async function runAudit(deep: boolean, fix: boolean, jsonOut: boolean) {
  if (!jsonOut) {
    pc.intro("🔒 HopCoderX Security Audit")
  }

  const findings: AuditFinding[] = []
  const spin = jsonOut ? null : pc.spinner()

  // 1. Config audit
  spin?.start("Auditing configuration…")
  await auditConfig(findings, fix)
  spin?.stop(`Config: ${countBySeverity(findings, ["critical", "high"])} issues`)

  // 2. Auth / credentials audit
  spin?.start("Auditing credentials…")
  await auditCredentials(findings)
  spin?.stop(`Credentials: ${countBySeverity(findings, ["critical", "high"])} issues`)

  // 3. File permission audit
  spin?.start("Auditing file permissions…")
  await auditFilePermissions(findings, fix)
  spin?.stop("File permissions checked")

  // 4. MCP server audit
  spin?.start("Auditing MCP servers…")
  await auditMCP(findings)
  spin?.stop("MCP servers checked")

  // 5. Dependency vulnerability scan
  if (deep) {
    spin?.start("Scanning dependencies (OSV-Scanner)…")
    await auditDependencies(findings)
    spin?.stop("Dependencies scanned")
  }

  // 6. Secret detection in config files
  spin?.start("Checking for secrets in config files…")
  await auditSecretsInConfig(findings)
  spin?.stop("Secret check done")

  if (jsonOut) {
    console.log(JSON.stringify({ findings, timestamp: new Date().toISOString() }, null, 2))
    return
  }

  // Print findings grouped by severity
  const bySeverity: Record<string, AuditFinding[]> = { critical: [], high: [], medium: [], low: [], info: [] }
  for (const f of findings) bySeverity[f.severity].push(f)

  const total = findings.length
  if (total === 0) {
    pc.note("No security issues found", "✅ Clean")
    pc.outro("Security audit passed")
    return
  }

  for (const sev of ["critical", "high", "medium", "low", "info"] as const) {
    const items = bySeverity[sev]
    if (!items.length) continue
    const icon = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" }[sev]
    console.log(`\n${icon} ${sev.toUpperCase()} (${items.length})`)
    for (const f of items) {
      console.log(`  [${f.category}] ${f.title}`)
      console.log(`    ${f.detail}`)
      if (f.fix) console.log(`    \x1b[32m→ Fix: ${f.fix}\x1b[0m`)
    }
  }

  const criticalCount = bySeverity.critical.length + bySeverity.high.length
  if (criticalCount > 0) {
    pc.outro(`\x1b[31m${criticalCount} critical/high findings — resolve before deploying\x1b[0m`)
  } else {
    pc.outro(`${total} findings (${bySeverity.medium.length} medium, ${bySeverity.low.length} low)`)
  }

  // Write report
  const reportPath = path.join(Global.Path.config, "security-audit.json")
  await Bun.write(reportPath, JSON.stringify({ findings, timestamp: new Date().toISOString(), deep }, null, 2))
  console.log(`\nReport saved: ${reportPath}`)
}

async function auditConfig(findings: AuditFinding[], fix: boolean) {
  let cfg: any
  try {
    cfg = await Config.get()
  } catch {
    findings.push({
      severity: "high",
      category: "config",
      title: "Invalid configuration",
      detail: "hopcoderx.json could not be parsed — config is broken or missing",
      fix: "Run: hopcoderx doctor --fix",
    })
    return
  }

  // Check for insecure CORS settings
  const corsOrigins = (cfg as any).cors?.origins
  if (Array.isArray(corsOrigins) && corsOrigins.includes("*")) {
    findings.push({
      severity: "high",
      category: "config",
      title: "Wildcard CORS origin",
      detail: 'cors.origins = ["*"] allows any origin to access your API',
      fix: 'Restrict to specific origins in hopcoderx.json: cors.origins = ["https://yourapp.com"]',
    })
  }

  // Check for auto-approve permissions
  const perms = (cfg as any).permission
  if (perms?.bash === "allow" && perms?.write === "allow" && perms?.edit === "allow") {
    findings.push({
      severity: "medium",
      category: "config",
      title: "All permissions auto-approved",
      detail: "bash + write + edit are all set to allow — agent can modify any file and run any command",
      fix: 'Set at least bash to "ask" for sensitive operations',
    })
  }
}

async function auditCredentials(findings: AuditFinding[]) {
  let authInfo: Record<string, any>
  try {
    authInfo = await Auth.all()
  } catch {
    return
  }

  for (const [provider, info] of Object.entries(authInfo)) {
    const keyLen = (info as any)?.key?.length ?? 0

    // Warn about suspiciously short API keys
    if (keyLen > 0 && keyLen < 20) {
      findings.push({
        severity: "medium",
        category: "credentials",
        title: `Short API key for ${provider}`,
        detail: `API key for "${provider}" is only ${keyLen} characters — may be truncated or invalid`,
        fix: `Re-authenticate: hopcoderx auth login ${provider}`,
      })
    }
  }
}

async function auditFilePermissions(findings: AuditFinding[], fix: boolean) {
  const sensitiveFiles = [
    path.join(Global.Path.config, "hopcoderx.json"),
    path.join(Global.Path.config, "secrets.enc.json"),
    path.join(Global.Path.config, "auth.json"),
  ]

  for (const file of sensitiveFiles) {
    const exists = await Filesystem.exists(file)
    if (!exists) continue

    // On Unix systems, check permissions
    if (process.platform !== "win32") {
      try {
        const stat = await Bun.file(file).stat?.()
        const mode = (stat as any)?.mode
        if (mode) {
          const isWorldReadable = (mode & 0o004) !== 0
          if (isWorldReadable) {
            findings.push({
              severity: "high",
              category: "filesystem",
              title: `World-readable sensitive file: ${path.basename(file)}`,
              detail: `${file} is readable by all users on this system`,
              fix: `chmod 600 "${file}"`,
            })
            if (fix) {
              await $`chmod 600 ${file}`.quiet()
            }
          }
        }
      } catch {
        // skip
      }
    }
  }
}

async function auditMCP(findings: AuditFinding[]) {
  let cfg: any
  try {
    cfg = await Config.get()
  } catch {
    return
  }

  const mcpServers: Record<string, any> = (cfg as any).mcp?.servers ?? {}
  for (const [name, server] of Object.entries(mcpServers)) {
    // Check for HTTP (non-HTTPS) MCP servers
    const url: string = (server as any).url ?? ""
    if (url.startsWith("http://") && !url.startsWith("http://localhost") && !url.startsWith("http://127.")) {
      findings.push({
        severity: "high",
        category: "mcp",
        title: `MCP server "${name}" uses insecure HTTP`,
        detail: `Server URL "${url}" transmits data unencrypted`,
        fix: "Switch to HTTPS or use localhost only",
      })
    }

    // Check for unauthenticated remote MCP servers
    const hasAuth = (server as any).headers?.Authorization || (server as any).apiKey || (server as any).token
    if (url && !url.includes("localhost") && !url.includes("127.0.0.1") && !hasAuth) {
      findings.push({
        severity: "medium",
        category: "mcp",
        title: `MCP server "${name}" has no authentication`,
        detail: "Remote MCP server configured without auth headers — may expose internal tools",
        fix: `Add authorization header or API key to the MCP server config`,
      })
    }
  }
}

async function auditDependencies(findings: AuditFinding[]) {
  try {
    // Run OSV-Scanner if available
    const result = await $`osv-scanner --json .`.quiet().nothrow()
    if (result.exitCode === 0 || result.exitCode === 1) {
      try {
        const data = JSON.parse(result.stdout.toString())
        const vulns = data?.results?.flatMap((r: any) => r.packages?.flatMap((p: any) => p.vulnerabilities ?? []) ?? []) ?? []
        for (const v of vulns.slice(0, 10)) {
          const severity = (v.database_specific?.severity ?? "unknown").toLowerCase()
          findings.push({
            severity: ["critical", "high", "medium", "low"].includes(severity)
              ? (severity as AuditFinding["severity"])
              : "medium",
            category: "dependencies",
            title: `Vulnerability: ${v.id}`,
            detail: v.summary ?? v.details ?? "Known vulnerability in dependency",
            fix: "Run: bun update or check OSV advisory for patched version",
          })
        }
      } catch {
        // OSV output parsing failed
      }
    }
  } catch {
    // OSV-Scanner not installed
    findings.push({
      severity: "info",
      category: "dependencies",
      title: "OSV-Scanner not installed",
      detail: "Install osv-scanner for dependency vulnerability scanning",
      fix: "Install: go install github.com/google/osv-scanner/cmd/osv-scanner@latest",
    })
  }
}

async function auditSecretsInConfig(findings: AuditFinding[]) {
  const configDir = Global.Path.config
  const secretPatterns = [
    /sk-[a-zA-Z0-9]{20,}/g, // OpenAI
    /AIza[0-9A-Za-z\-_]{35}/g, // Google
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub PAT
    /glpat-[a-zA-Z0-9\-_]{20}/g, // GitLab PAT
    /AKIA[0-9A-Z]{16}/g, // AWS Access Key
    /(?:password|secret|token)\s*[:=]\s*["']?[^"'\s]{8,}/gi, // generic
  ]

  const configFiles = ["hopcoderx.json", "hopcoderx.jsonc"]
  for (const file of configFiles) {
    const filePath = path.join(configDir, file)
    const exists = await Filesystem.exists(filePath)
    if (!exists) continue

    try {
      const content = await Filesystem.readText(filePath)
      for (const pattern of secretPatterns) {
        pattern.lastIndex = 0
        if (pattern.test(content)) {
          findings.push({
            severity: "critical",
            category: "secrets",
            title: `Potential secret in config file: ${file}`,
            detail: "Config file may contain hardcoded credentials or API keys",
            fix: "Move secrets to environment variables or use: hopcoderx secrets set KEY value",
          })
          break
        }
      }
    } catch {
      // skip
    }
  }
}

async function runCodeScan(deep: boolean, jsonOut: boolean) {
  if (!jsonOut) pc.intro("🔍 Code Security Scan")

  const findings: AuditFinding[] = []
  const spin = jsonOut ? null : pc.spinner()

  spin?.start("Running Semgrep…")
  const semgrepResult = await $`semgrep --config auto --json --quiet .`.quiet().nothrow()
  if (semgrepResult.exitCode === 0 || semgrepResult.exitCode === 1) {
    try {
      const data = JSON.parse(semgrepResult.stdout.toString())
      for (const r of (data.results ?? []).slice(0, 20)) {
        findings.push({
          severity: r.extra?.severity === "ERROR" ? "high" : r.extra?.severity === "WARNING" ? "medium" : "low",
          category: "semgrep",
          title: r.check_id ?? "Semgrep finding",
          detail: `${r.path}:${r.start?.line} — ${r.extra?.message ?? r.message ?? ""}`,
          fix: r.extra?.fix ?? undefined,
        })
      }
      spin?.stop(`Semgrep: ${findings.length} findings`)
    } catch {
      spin?.stop("Semgrep output parsing failed")
    }
  } else {
    spin?.stop("Semgrep not installed or no findings")
    findings.push({
      severity: "info",
      category: "semgrep",
      title: "Semgrep not installed",
      detail: "Install Semgrep for deep code security scanning",
      fix: "Install: pip install semgrep  or  brew install semgrep",
    })
  }

  if (jsonOut) {
    console.log(JSON.stringify({ findings }, null, 2))
    return
  }

  if (findings.length === 0) {
    pc.outro("No code security issues found ✅")
    return
  }

  for (const f of findings) {
    const icon = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" }[f.severity]
    console.log(`${icon} ${f.title}`)
    console.log(`   ${f.detail}`)
    if (f.fix) console.log(`   \x1b[32m→ ${f.fix}\x1b[0m`)
  }
  pc.outro(`Scan complete: ${findings.length} findings`)
}

async function runReport() {
  const reportPath = path.join(Global.Path.config, "security-audit.json")
  const exists = await Filesystem.exists(reportPath)
  if (!exists) {
    console.error("No audit report found. Run: hopcoderx security audit first.")
    process.exit(1)
  }
  const content = await Filesystem.readText(reportPath)
  const report = JSON.parse(content)
  console.log(`\nSecurity Audit Report`)
  console.log(`Generated: ${report.timestamp}`)
  console.log(`Deep scan: ${report.deep ? "yes" : "no"}`)
  console.log(`Total findings: ${report.findings.length}`)
  console.log("")
  console.log(JSON.stringify(report, null, 2))
}

function countBySeverity(findings: AuditFinding[], severities: string[]): number {
  return findings.filter((f) => severities.includes(f.severity)).length
}
