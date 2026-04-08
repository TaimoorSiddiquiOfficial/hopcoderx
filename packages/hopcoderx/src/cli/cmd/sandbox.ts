/**
 * `hopcoderx sandbox` — Docker sandboxed code execution.
 *
 * Runs untrusted/generated code inside a Docker container with:
 * - No network access (--network=none)
 * - Read-only root filesystem (--read-only)
 * - Strict resource limits (--memory, --cpus, --pids-limit)
 * - No new privileges (--security-opt=no-new-privileges)
 * - Automatic cleanup (--rm)
 *
 * Sub-commands:
 *   sandbox run <file>            Run a file in sandbox
 *   sandbox exec <code>           Execute inline code snippet
 *   sandbox check                 Verify Docker is available
 *   sandbox images                List available sandbox images
 */

import { execFile } from "child_process"
import { promisify } from "util"
import { writeFile, unlink, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import type { Argv } from "yargs"
import { cmd } from "./cmd"

const execFileAsync = promisify(execFile)

// Sandbox images for each language
const SANDBOX_IMAGES: Record<string, { image: string; runCmd: (file: string) => string[] }> = {
  ".js":   { image: "node:22-alpine",   runCmd: (f) => ["node", f] },
  ".ts":   { image: "node:22-alpine",   runCmd: (f) => ["npx", "tsx", f] },
  ".py":   { image: "python:3.12-slim", runCmd: (f) => ["python3", f] },
  ".sh":   { image: "alpine:3.20",      runCmd: (f) => ["sh", f] },
  ".rb":   { image: "ruby:3.3-alpine",  runCmd: (f) => ["ruby", f] },
  ".go":   { image: "golang:1.22-alpine", runCmd: (f) => ["go", "run", f] },
  ".rs":   { image: "rust:1.78-alpine", runCmd: (f) => ["rustc", f, "-o", "/tmp/prog", "&&", "/tmp/prog"] },
}

const DEFAULT_LIMITS = {
  memory: "256m",
  cpus: "0.5",
  pidsLimit: 64,
  timeoutSecs: 30,
}

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"])
    return true
  } catch {
    return false
  }
}

async function runInSandbox(opts: {
  file: string
  ext: string
  memoryLimit?: string
  cpuLimit?: string
  timeoutSecs?: number
}): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const { file, ext } = opts
  const limits = {
    memory: opts.memoryLimit ?? DEFAULT_LIMITS.memory,
    cpus: opts.cpuLimit ?? DEFAULT_LIMITS.cpus,
    pidsLimit: DEFAULT_LIMITS.pidsLimit,
    timeoutSecs: opts.timeoutSecs ?? DEFAULT_LIMITS.timeoutSecs,
  }

  const sandbox = SANDBOX_IMAGES[ext]
  if (!sandbox) throw new Error(`No sandbox image for extension ${ext}. Supported: ${Object.keys(SANDBOX_IMAGES).join(", ")}`)

  const containerFile = `/sandbox/code${ext}`
  const dockerArgs = [
    "run", "--rm",
    "--network=none",
    "--read-only",
    "--tmpfs=/tmp:size=64m",
    `--memory=${limits.memory}`,
    `--cpus=${limits.cpus}`,
    `--pids-limit=${limits.pidsLimit}`,
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "-v", `${file}:${containerFile}:ro`,
    sandbox.image,
    ...sandbox.runCmd(containerFile),
  ]

  return new Promise((resolve) => {
    const proc = require("child_process").spawn("docker", dockerArgs, { stdio: "pipe" })
    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill("SIGKILL")
    }, limits.timeoutSecs * 1000)

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })

    proc.on("close", (exitCode: number | null) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: exitCode ?? 1, timedOut })
    })
  })
}

export const SandboxCommand = cmd({
  command: "sandbox <action>",
  describe: "Docker sandboxed code execution (isolated, safe, resource-limited)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        describe: "Action",
        type: "string",
        choices: ["run", "exec", "check", "images"] as const,
      })
      .option("file",    { alias: "f", type: "string", description: "File to run" })
      .option("code",    { alias: "c", type: "string", description: "Inline code to execute" })
      .option("lang",    { alias: "l", type: "string", description: "Language extension (.js, .py, .ts, etc.)" })
      .option("memory",  { type: "string", description: "Memory limit (default: 256m)" })
      .option("cpus",    { type: "string", description: "CPU limit (default: 0.5)" })
      .option("timeout", { type: "number", description: "Timeout in seconds (default: 30)" }),
  handler: async (args: {
    action?: string
    file?: string
    code?: string
    lang?: string
    memory?: string
    cpus?: string
    timeout?: number
  }) => {
    switch (args.action ?? "") {
      case "check": {
        const ok = await dockerAvailable()
        if (ok) {
          console.log("✅ Docker is available — sandbox is ready.")
        } else {
          console.error("❌ Docker not found. Install Docker to use sandbox features.")
          console.error("   https://docs.docker.com/get-docker/")
          process.exit(1)
        }
        break
      }

      case "images": {
        console.log("\n🐳 Available sandbox images:\n")
        for (const [ext, s] of Object.entries(SANDBOX_IMAGES)) {
          console.log(`  ${ext.padEnd(5)}  ${s.image}`)
        }
        break
      }

      case "run":
      case "exec": {
        if (!(await dockerAvailable())) {
          console.error("❌ Docker not found. Run `hopcoderx sandbox check` for details.")
          process.exit(1)
        }

        let filePath: string
        let ext: string
        let tempFile: string | null = null

        if (args.action === "exec") {
          const code = args.code
          if (!code) { console.error("Provide code with --code"); process.exit(1) }
          ext = args.lang ?? ".py"
          const dir = join(tmpdir(), "hopcoderx-sandbox")
          await mkdir(dir, { recursive: true })
          tempFile = join(dir, `snippet${ext}`)
          await writeFile(tempFile, code, "utf8")
          filePath = tempFile
        } else {
          filePath = args.file ?? ""
          if (!filePath) { console.error("Provide --file path"); process.exit(1) }
          ext = args.lang ?? "." + filePath.split(".").pop()
        }

        console.log(`\n🔐 Running in sandbox (${ext}, memory=${args.memory ?? DEFAULT_LIMITS.memory})…\n`)

        let result: Awaited<ReturnType<typeof runInSandbox>>
        try {
          result = await runInSandbox({
            file: filePath,
            ext,
            memoryLimit: args.memory,
            cpuLimit: args.cpus,
            timeoutSecs: args.timeout,
          })
        } finally {
          if (tempFile) await unlink(tempFile).catch(() => {})
        }

        if (result.timedOut) {
          console.error(`⏱ Execution timed out after ${args.timeout ?? DEFAULT_LIMITS.timeoutSecs}s`)
        }
        if (result.stdout) { console.log("STDOUT:"); console.log(result.stdout) }
        if (result.stderr) { console.error("STDERR:"); console.error(result.stderr) }
        if (result.exitCode !== 0) {
          console.error(`\nExit code: ${result.exitCode}`)
        } else {
          console.log(`\n✅ Exit code: 0`)
        }
        process.exitCode = result.exitCode
        break
      }

      default:
        console.error(`Unknown action: ${args.action}`)
        process.exit(1)
    }
  },
})
