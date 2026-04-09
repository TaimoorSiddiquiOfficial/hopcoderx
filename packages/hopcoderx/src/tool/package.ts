/**
 * Package manager tool — unified interface across npm/bun/pnpm/pip/go/cargo.
 *
 * Auto-detects the package manager from lockfiles, then runs the
 * appropriate command for install, add, remove, update, audit, outdated.
 */

import z from "zod"
import { Tool } from "./tool"
import { execFile, exec } from "child_process"
import { promisify } from "util"
import { Instance } from "../project/instance"
import { existsSync } from "fs"
import path from "path"

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

type Meta = Record<string, unknown>

type PM= "npm" | "bun" | "pnpm" | "yarn" | "pip" | "go" | "cargo"

function detectPM(dir: string): PM {
  const has = (f: string) => existsSync(path.join(dir, f))
  if (has("bun.lockb") || has("bun.lock")) return "bun"
  if (has("pnpm-lock.yaml")) return "pnpm"
  if (has("yarn.lock")) return "yarn"
  if (has("package.json") || has("package-lock.json")) return "npm"
  if (has("go.mod")) return "go"
  if (has("Cargo.toml")) return "cargo"
  if (has("requirements.txt") || has("pyproject.toml")) return "pip"
  return "npm"
}

const OPERATIONS = ["install", "add", "remove", "update", "audit", "outdated", "list", "run", "info"] as const

function buildCmd(pm: PM, op: (typeof OPERATIONS)[number], packages: string[], extra: string[]): string[] {
  const pkg = packages.join(" ")
  switch (pm) {
    case "bun":
      switch (op) {
        case "install": return ["bun", "install", ...extra]
        case "add": return ["bun", "add", ...packages, ...extra]
        case "remove": return ["bun", "remove", ...packages, ...extra]
        case "update": return packages.length ? ["bun", "update", ...packages, ...extra] : ["bun", "update", ...extra]
        case "audit": return ["bun", "audit", ...extra]
        case "outdated": return ["bun", "outdated", ...extra]
        case "list": return ["bun", "pm", "ls", ...extra]
        case "run": return ["bun", "run", ...packages, ...extra]
        case "info": return ["bun", "pm", "hash", ...extra]
      }
      break
    case "pnpm":
      switch (op) {
        case "install": return ["pnpm", "install", ...extra]
        case "add": return ["pnpm", "add", ...packages, ...extra]
        case "remove": return ["pnpm", "remove", ...packages, ...extra]
        case "update": return packages.length ? ["pnpm", "update", ...packages, ...extra] : ["pnpm", "update", ...extra]
        case "audit": return ["pnpm", "audit", ...extra]
        case "outdated": return ["pnpm", "outdated", ...extra]
        case "list": return ["pnpm", "list", "--depth=1", ...extra]
        case "run": return ["pnpm", "run", ...packages, ...extra]
        case "info": return ["pnpm", "info", ...packages, ...extra]
      }
      break
    case "yarn":
      switch (op) {
        case "install": return ["yarn", "install", ...extra]
        case "add": return ["yarn", "add", ...packages, ...extra]
        case "remove": return ["yarn", "remove", ...packages, ...extra]
        case "update": return packages.length ? ["yarn", "upgrade", ...packages, ...extra] : ["yarn", "upgrade", ...extra]
        case "audit": return ["yarn", "audit", ...extra]
        case "outdated": return ["yarn", "outdated", ...extra]
        case "list": return ["yarn", "list", "--depth=1", ...extra]
        case "run": return ["yarn", ...packages, ...extra]
        case "info": return ["yarn", "info", ...packages, ...extra]
      }
      break
    case "pip":
      switch (op) {
        case "install": return ["pip", "install", "-r", "requirements.txt", ...extra]
        case "add": return ["pip", "install", ...packages, ...extra]
        case "remove": return ["pip", "uninstall", "-y", ...packages, ...extra]
        case "update": return packages.length ? ["pip", "install", "--upgrade", ...packages, ...extra] : ["pip", "list", "--outdated"]
        case "audit": return ["pip", "audit", ...extra]  // pip-audit if installed
        case "outdated": return ["pip", "list", "--outdated", ...extra]
        case "list": return ["pip", "list", ...extra]
        case "info": return ["pip", "show", ...packages, ...extra]
        default: return ["pip", op, ...packages, ...extra]
      }
    case "go":
      switch (op) {
        case "install": return ["go", "mod", "download", ...extra]
        case "add": return ["go", "get", ...packages, ...extra]
        case "remove": return ["go", "mod", "edit", "-droprequire", ...packages, ...extra]
        case "update": return ["go", "get", "-u", ...packages.map(p => `${p}@latest`), ...extra]
        case "audit": return ["go", "mod", "verify", ...extra]
        case "outdated": return ["go", "list", "-u", "-m", "all", ...extra]
        case "list": return ["go", "list", "-m", "all", ...extra]
        case "info": return ["go", "doc", ...packages, ...extra]
        default: return ["go", op, ...packages, ...extra]
      }
    case "cargo":
      switch (op) {
        case "install": return ["cargo", "build", ...extra]
        case "add": return ["cargo", "add", ...packages, ...extra]
        case "remove": return ["cargo", "remove", ...packages, ...extra]
        case "update": return packages.length ? ["cargo", "update", ...packages.map(p => `-p`).flatMap((f, i) => [f, packages[i]!]), ...extra] : ["cargo", "update", ...extra]
        case "audit": return ["cargo", "audit", ...extra]
        case "outdated": return ["cargo", "outdated", ...extra]
        case "list": return ["cargo", "tree", "--depth=1", ...extra]
        case "info": return ["cargo", "search", ...packages, ...extra]
        default: return ["cargo", op, ...packages, ...extra]
      }
    default: // npm
      switch (op) {
        case "install": return ["npm", "install", ...extra]
        case "add": return ["npm", "install", ...packages, ...extra]
        case "remove": return ["npm", "uninstall", ...packages, ...extra]
        case "update": return packages.length ? ["npm", "update", ...packages, ...extra] : ["npm", "update", ...extra]
        case "audit": return ["npm", "audit", ...extra]
        case "outdated": return ["npm", "outdated", ...extra]
        case "list": return ["npm", "list", "--depth=1", ...extra]
        case "run": return ["npm", "run", ...packages, ...extra]
        case "info": return ["npm", "info", ...packages, ...extra]
      }
  }
  return [pm, op, ...packages, ...extra]
}

export const PackageTool = Tool.define("package", {
  description:
    "Manage packages across npm, bun, pnpm, yarn, pip, go, and cargo. Auto-detects the package manager from lockfiles. Operations: install (install all deps), add (add package), remove, update, audit (security check), outdated, list, run (script), info.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).describe("Operation to perform"),
    packages: z.array(z.string()).optional().describe("Package name(s) for add/remove/update/info"),
    args: z.array(z.string()).optional().describe("Extra flags passed directly to the package manager"),
    package_manager: z
      .enum(["npm", "bun", "pnpm", "yarn", "pip", "go", "cargo"])
      .optional()
      .describe("Override auto-detected package manager"),
    dev: z.boolean().optional().describe("Install as dev dependency (add operation)"),
    global: z.boolean().optional().describe("Install globally (add operation)"),
  }),
  async execute(params, ctx) {
    const cwd = Instance.worktree || Instance.directory
    const pm = params.package_manager ?? detectPM(cwd)
    const packages = params.packages ?? []
    const extra = params.args ?? []

    if (params.dev && (pm === "npm" || pm === "pnpm" || pm === "yarn" || pm === "bun")) {
      extra.push("-D")
    }
    if (params.global && (pm === "npm" || pm === "pnpm" || pm === "bun")) {
      extra.push("-g")
    }

    await ctx.ask({
      permission: "package",
      patterns: packages.length ? packages : [params.operation],
      always: ["outdated", "list", "info", "audit"],
      metadata: { operation: params.operation, pm, packages },
    })

    const cmdParts = buildCmd(pm, params.operation, packages, extra)
    const [cmd, ...args] = cmdParts

    try {
      const { stdout, stderr } = await execFileAsync(cmd!, args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
      })
      const output = [stdout, stderr].filter(Boolean).join("\n").trim()
      return {
        title: `${pm} ${params.operation}${packages.length ? ` ${packages.join(" ")}` : ""}`,
        output: output || "Done (no output)",
        metadata: { pm, operation: params.operation, packages } as Meta,
      }
    } catch (e: any) {
      const errMsg = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim()
      return {
        title: `${pm} ${params.operation} — error`,
        output: errMsg || String(e),
        metadata: { pm, operation: params.operation, error: true } as Meta,
      }
    }
  },
})
