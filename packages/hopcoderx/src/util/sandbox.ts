/**
 * Docker/Podman sandbox utility — isolated code execution environment.
 *
 * Runs arbitrary commands inside a container with:
 *   - Read-only project mount + writable /tmp
 *   - Network isolation (--network none by default)
 *   - CPU/memory limits
 *   - Non-root user (uid=1000)
 *   - Auto-cleanup
 *
 * Usage:
 *   const result = await Sandbox.run({ command: "node index.js", timeout: 10000 })
 *   console.log(result.stdout, result.stderr, result.exitCode)
 */

import { Log } from "./log"
import { Instance } from "../project/instance"
import path from "path"
import { existsSync } from "fs"

const log = Log.create({ service: "sandbox" })

const DEFAULT_IMAGE = process.env.HOPCODERX_SANDBOX_IMAGE ?? "node:20-alpine"
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MEMORY = "256m"
const DEFAULT_CPUS = "0.5"

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  durationMs: number
}

export interface SandboxOptions {
  /** Shell command to run inside the container */
  command: string
  /** Working directory to mount (default: Instance.directory) */
  workdir?: string
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Docker image to use (default: node:20-alpine) */
  image?: string
  /** Allow network access (default: false) */
  network?: boolean
  /** Memory limit (default: 256m) */
  memory?: string
  /** CPU quota (default: 0.5) */
  cpus?: string
  /** Additional environment variables */
  env?: Record<string, string>
  /** Allow writing to the mounted directory (default: false = read-only) */
  writable?: boolean
}

async function detectRuntime(): Promise<"docker" | "podman" | null> {
  for (const runtime of ["docker", "podman"] as const) {
    try {
      const proc = Bun.spawn([runtime, "info"], { stdout: "pipe", stderr: "pipe" })
      const code = await proc.exited
      if (code === 0) return runtime
    } catch {}
  }
  return null
}

export namespace Sandbox {
  let _runtime: "docker" | "podman" | null | undefined = undefined

  export async function isAvailable(): Promise<boolean> {
    if (_runtime === undefined) _runtime = await detectRuntime()
    return _runtime !== null
  }

  export async function run(opts: SandboxOptions): Promise<SandboxResult> {
    if (_runtime === undefined) _runtime = await detectRuntime()
    if (!_runtime) {
      return {
        stdout: "",
        stderr: "Docker/Podman not available. Install Docker Desktop or Podman to use --sandbox mode.",
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
      }
    }

    const runtime = _runtime
    const workdir = opts.workdir ?? Instance.directory ?? process.cwd()
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS
    const image = opts.image ?? DEFAULT_IMAGE
    const startTime = Date.now()

    const args = [
      "run",
      "--rm",
      "--interactive",
      "--no-healthcheck",
      `--memory=${opts.memory ?? DEFAULT_MEMORY}`,
      `--cpus=${opts.cpus ?? DEFAULT_CPUS}`,
      "--pids-limit=100",
      "--security-opt=no-new-privileges",
    ]

    // Network
    if (!opts.network) args.push("--network=none")

    // Mount project directory
    const mountMode = opts.writable ? "rw" : "ro"
    args.push(`--volume=${workdir}:/workspace:${mountMode}`)
    args.push("--workdir=/workspace")

    // Environment variables
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        args.push(`--env=${k}=${v}`)
      }
    }

    // Non-root user
    args.push("--user=1000:1000")

    args.push(image)
    args.push("sh", "-c", opts.command)

    log.info("sandbox run", { runtime, image, command: opts.command.slice(0, 100) })

    const proc = Bun.spawn([runtime, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    // Timeout handling
    const timeoutHandle = setTimeout(() => proc.kill("SIGKILL"), timeout)

    let timedOut = false
    const exitCode = await proc.exited.catch(() => -1)

    if (exitCode === null) timedOut = true
    clearTimeout(timeoutHandle)

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const durationMs = Date.now() - startTime

    log.info("sandbox done", { exitCode, timedOut, durationMs })

    return { stdout, stderr, exitCode: exitCode ?? 1, timedOut, durationMs }
  }

  /** Pull a Docker image if not already present */
  export async function pullImage(image: string = DEFAULT_IMAGE): Promise<void> {
    if (_runtime === undefined) _runtime = await detectRuntime()
    if (!_runtime) return
    const proc = Bun.spawn([_runtime, "pull", image], { stdout: "inherit", stderr: "inherit" })
    await proc.exited
  }

  /** Check if an image exists locally */
  export async function imageExists(image: string = DEFAULT_IMAGE): Promise<boolean> {
    if (_runtime === undefined) _runtime = await detectRuntime()
    if (!_runtime) return false
    const proc = Bun.spawn([_runtime, "image", "inspect", image], { stdout: "pipe", stderr: "pipe" })
    return (await proc.exited) === 0
  }
}
