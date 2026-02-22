/**
 * hopcoderx-wakatime
 *
 * WakaTime plugin for HopCoderX.
 * Tracks file activity via the wakatime-cli tool and sends heartbeats to the
 * WakaTime API with AI-coding metrics.
 *
 * Configuration:
 *   ~/.wakatime.cfg  [settings]  api_key = waka_...
 *
 * Usage (hopcoderx.json):
 *   { "plugin": ["hopcoderx-wakatime"] }
 */

import type { Plugin, Hooks } from "@hopcoderx/plugin"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"

// ─── wakatime-cli resolution ─────────────────────────────────────────────────

function cliPath(): string {
  const ext = process.platform === "win32" ? ".exe" : ""
  return path.join(os.homedir(), ".wakatime", `wakatime-cli${ext}`)
}

async function cliExists(): Promise<boolean> {
  return fs
    .access(cliPath())
    .then(() => true)
    .catch(() => false)
}

const WAKATIME_DIR = path.join(os.homedir(), ".wakatime")

async function ensureDir() {
  await fs.mkdir(WAKATIME_DIR, { recursive: true })
}

async function downloadCli(): Promise<void> {
  await ensureDir()
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "amd64"
  const ext = process.platform === "win32" ? ".exe" : ""
  const url = `https://github.com/wakatime/wakatime-cli/releases/latest/download/wakatime-cli-${platform}-${arch}${ext}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    const dest = cliPath()
    await fs.writeFile(dest, new Uint8Array(buf))
    if (process.platform !== "win32") await fs.chmod(dest, 0o755)
  } catch (err) {
    // Silent – CLI not available, heartbeats will be skipped
  }
}

// ─── Heartbeat queue ─────────────────────────────────────────────────────────

type Heartbeat = {
  file: string
  project: string
  additions: number
  deletions: number
  isWrite: boolean
}

const queue: Heartbeat[] = []
// Rate limit: one flush per project per minute
const lastFlush = new Map<string, number>()

function queueHeartbeat(hb: Heartbeat) {
  queue.push(hb)
}

async function flushQueue(pluginVersion: string) {
  if (!(await cliExists())) return
  const now = Date.now()
  const toSend = queue.splice(0)
  if (!toSend.length) return

  for (const hb of toSend) {
    const last = lastFlush.get(hb.project) ?? 0
    if (now - last < 60_000) continue
    lastFlush.set(hb.project, now)

    const args = [
      "--entity", hb.file,
      "--project", hb.project,
      "--category", "ai coding",
      "--plugin", `hopcoderx-wakatime/${pluginVersion}`,
    ]
    if (hb.isWrite) args.push("--write")
    if (hb.additions !== 0 || hb.deletions !== 0) {
      args.push("--ai-line-changes", String(hb.additions - hb.deletions))
    }

    spawn(cliPath(), args, { stdio: "ignore", detached: true }).unref()
  }
}

// ─── Part extraction helpers ─────────────────────────────────────────────────

function extractFileFromPart(part: any, toolName: string): Heartbeat | undefined {
  if (part.type !== "tool-invocation") return undefined
  if (part.toolName !== toolName) return undefined
  if (part.state !== "result") return undefined

  const args: any = part.args ?? {}

  // edit tool – has filePath, diff metadata in result
  if (toolName === "edit") {
    const file: string = args.filePath ?? ""
    if (!file) return undefined
    const meta: any = part.result?.metadata ?? {}
    return {
      file,
      project: process.cwd(),
      additions: meta.additions ?? 0,
      deletions: meta.deletions ?? 0,
      isWrite: true,
    }
  }

  // write tool
  if (toolName === "write") {
    const file: string = args.filePath ?? args.file ?? ""
    if (!file) return undefined
    const lines: number = (args.content ?? "").split("\n").length
    return { file, project: process.cwd(), additions: lines, deletions: 0, isWrite: true }
  }

  // read tool
  if (toolName === "read") {
    const file: string = args.filePath ?? args.file ?? ""
    if (!file) return undefined
    return { file, project: process.cwd(), additions: 0, deletions: 0, isWrite: false }
  }

  return undefined
}

// ─── Plugin export ────────────────────────────────────────────────────────────

const VERSION = "1.0.0"

export const WakatimePlugin: Plugin = async (ctx): Promise<Hooks> => {
  // Ensure CLI is available in background
  if (!(await cliExists())) void downloadCli()

  return {
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool
      if (!["edit", "write", "read"].includes(toolName)) return

      const fakeArgs = input.args ?? {}
      const file: string = fakeArgs.filePath ?? fakeArgs.file ?? fakeArgs.path ?? ""
      if (!file) return

      const isWrite = toolName !== "read"
      queueHeartbeat({
        file,
        project: ctx.directory,
        additions: 0,
        deletions: 0,
        isWrite,
      })
    },

    "chat.message": async (_input, _output) => {
      // Triggered on every chat message – use as opportunity to flush queue
      void flushQueue(VERSION)
    },

    event: async ({ event }) => {
      const type: string = (event as any)?.payload?.type ?? (event as any)?.type ?? ""
      // Session ended / idle – flush remaining heartbeats
      if (type === "session.updated" || type === "session.error") {
        void flushQueue(VERSION)
      }
    },
  }
}

export default WakatimePlugin
