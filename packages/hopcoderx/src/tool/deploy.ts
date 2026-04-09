/**
 * Deploy tool — deploy to Vercel, Railway, Fly.io, or Docker.
 *
 * Auto-detects framework (Next.js, Vite, Express, etc.) and guides
 * deployment with the appropriate CLI tool. Performs health check after.
 */

import z from "zod"
import { Tool } from "./tool"
import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"

const execFileAsync = promisify(execFile)

type Platform = "vercel" | "railway" | "fly" | "docker" | "auto"
type Meta = { platform?: string; framework?: string; success?: boolean; operation?: string }

async function detectFramework(cwd: string): Promise<string> {
  try {
    const pkgPath = path.join(cwd, "package.json")
    if (!existsSync(pkgPath)) return "unknown"
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps["next"]) return "next"
    if (deps["@remix-run/node"]) return "remix"
    if (deps["nuxt"]) return "nuxt"
    if (deps["vite"]) return existsSync(path.join(cwd, "index.html")) ? "vite-spa" : "vite-lib"
    if (deps["express"] || deps["fastify"] || deps["hono"]) return "node-server"
    if (deps["react"]) return "react"
    return "node"
  } catch {
    return "unknown"
  }
}

async function detectPlatform(cwd: string): Promise<Platform> {
  if (existsSync(path.join(cwd, ".vercel"))) return "vercel"
  if (existsSync(path.join(cwd, "railway.json")) || existsSync(path.join(cwd, "railway.toml"))) return "railway"
  if (existsSync(path.join(cwd, "fly.toml"))) return "fly"
  if (existsSync(path.join(cwd, "Dockerfile")) || existsSync(path.join(cwd, "docker-compose.yml"))) return "docker"
  return "auto"
}

async function runCmd(cmd: string, args: string[], cwd: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 5 * 1024 * 1024, timeout: 300_000 })
    return { success: true, output: [stdout, stderr].filter(Boolean).join("\n").trim() }
  } catch (e: any) {
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim()
    return { success: false, output }
  }
}

async function healthCheck(url: string): Promise<{ ok: boolean; status?: number; latencyMs: number }> {
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - start }
  } catch {
    return { ok: false, latencyMs: Date.now() - start }
  }
}

const OPERATIONS = ["deploy", "status", "logs", "info"] as const

export const DeployTool = Tool.define("deploy", {
  description:
    "Deploy your application to Vercel, Railway, Fly.io, or Docker. Auto-detects platform from config files (fly.toml, railway.json, .vercel/, Dockerfile). Runs health check after deploy. Use `status` to check deployment status, `logs` to tail recent logs.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).default("deploy").describe("deploy: build and deploy | status: check deployment | logs: tail logs | info: show platform/framework"),
    platform: z.enum(["vercel", "railway", "fly", "docker", "auto"]).optional().default("auto").describe("Target platform (auto-detects from config files)"),
    environment: z.enum(["production", "preview", "staging"]).optional().default("production").describe("Deployment environment"),
    health_check_url: z.string().url().optional().describe("URL to health check after deploy"),
    build_command: z.string().optional().describe("Override build command"),
    args: z.array(z.string()).optional().describe("Extra CLI args passed to the deploy command"),
  }),
  async execute(params, ctx) {
    const cwd = Instance.worktree || Instance.directory

    await ctx.ask({
      permission: "deploy",
      patterns: [params.platform ?? "auto", params.environment ?? "production"],
      always: ["info", "status", "logs"],
      metadata: { operation: params.operation, platform: params.platform },
    })

    const framework = await detectFramework(cwd)
    const detectedPlatform = params.platform === "auto" ? await detectPlatform(cwd) : params.platform ?? "auto"

    if (params.operation === "info") {
      return {
        title: "deploy info",
        output: `Framework: ${framework}\nDetected platform: ${detectedPlatform}\nDirectory: ${cwd}`,
        metadata: { framework, platform: detectedPlatform } as Meta,
      }
    }

    if (detectedPlatform === "auto") {
      return {
        title: "deploy",
        output: `Could not detect platform. No fly.toml, railway.json, .vercel/, or Dockerfile found.\n\nRun: vercel / railway up / fly launch / docker build`,
        metadata: { platform: "none" } as Meta,
      }
    }

    const env = params.environment ?? "production"
    const extra = params.args ?? []

    let cmd: string
    let cmdArgs: string[]

    switch (detectedPlatform) {
      case "vercel":
        if (params.operation === "logs") { cmd = "vercel"; cmdArgs = ["logs", ...extra]; break }
        if (params.operation === "status") { cmd = "vercel"; cmdArgs = ["inspect", ...extra]; break }
        cmd = "vercel"
        cmdArgs = env === "production" ? ["--prod", ...extra] : [...extra]
        break
      case "railway":
        if (params.operation === "logs") { cmd = "railway"; cmdArgs = ["logs", ...extra]; break }
        if (params.operation === "status") { cmd = "railway"; cmdArgs = ["status", ...extra]; break }
        cmd = "railway"
        cmdArgs = ["up", "--environment", env, ...extra]
        break
      case "fly":
        if (params.operation === "logs") { cmd = "fly"; cmdArgs = ["logs", ...extra]; break }
        if (params.operation === "status") { cmd = "fly"; cmdArgs = ["status", ...extra]; break }
        cmd = "fly"
        cmdArgs = ["deploy", "--remote-only", ...extra]
        break
      case "docker":
        if (params.operation === "logs") { cmd = "docker"; cmdArgs = ["compose", "logs", "--tail=100", ...extra]; break }
        if (params.operation === "status") { cmd = "docker"; cmdArgs = ["compose", "ps", ...extra]; break }
        cmd = "docker"
        cmdArgs = ["compose", "up", "--build", "-d", ...extra]
        break
      default:
        return { title: "deploy", output: `Unsupported platform: ${detectedPlatform}`, metadata: {} as Meta }
    }

    const { success, output } = await runCmd(cmd, cmdArgs, cwd)

    let healthResult = ""
    if (success && params.operation === "deploy" && params.health_check_url) {
      const hc = await healthCheck(params.health_check_url)
      healthResult = hc.ok
        ? `\n\n✅ Health check: ${hc.status} (${hc.latencyMs}ms)`
        : `\n\n❌ Health check failed (${hc.latencyMs}ms)`
    }

    return {
      title: `deploy ${detectedPlatform} ${params.operation}`,
      output: (success ? `✅ ` : `❌ `) + `${detectedPlatform} ${params.operation}:\n\n${output}${healthResult}`,
      metadata: { platform: detectedPlatform, framework, success, operation: params.operation } as Meta,
    }
  },
})
