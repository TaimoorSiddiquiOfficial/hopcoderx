/**
 * hopcoderx-tmux
 *
 * Tmux integration plugin for HopCoderX.
 * Automatically spawns a terminal pane when an agent session starts so you
 * can watch live output without leaving your current window.
 *
 * Platform support:
 *   Linux / macOS  – requires tmux (brew install tmux / apt install tmux)
 *   Windows        – uses Windows Terminal (wt.exe) when available,
 *                    falls back to a new PowerShell window
 *
 * Config  (~/.config/hopcoderx/opentmux.json):
 * {
 *   "enabled":        true,        // master switch (default: true)
 *   "layout":         "main-vertical", // tmux layout (Linux/macOS only)
 *   "main_pane_size": 60,          // percentage for main pane (20-80)
 *   "auto_close":     true,        // close pane when session ends
 *   "port":           4096         // hopcoderx server port (auto-detected if unset)
 * }
 *
 * Usage (hopcoderx.json):
 *   { "plugin": ["hopcoderx-tmux"] }
 */

import type { Plugin, Hooks } from "@hopcoderx/plugin"
import { spawn, execSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"

// ─── Config ──────────────────────────────────────────────────────────────────

type TmuxConfig = {
  enabled: boolean
  layout: string
  main_pane_size: number
  auto_close: boolean
  port?: number
}

const DEFAULT_CONFIG: TmuxConfig = {
  enabled: true,
  layout: "main-vertical",
  main_pane_size: 60,
  auto_close: true,
}

async function loadConfig(): Promise<TmuxConfig> {
  const configDir =
    process.env.HOPCODERX_CONFIG_DIR ??
    (process.platform === "win32"
      ? path.join(process.env.APPDATA ?? os.homedir(), "hopcoderx")
      : path.join(os.homedir(), ".config", "hopcoderx"))

  const configFile = path.join(configDir, "opentmux.json")
  try {
    const raw = await fs.readFile(configFile, "utf8")
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

// ─── Platform detection ───────────────────────────────────────────────────────

type Platform = "tmux" | "windows-terminal" | "powershell" | "unsupported"

function detectPlatform(): Platform {
  if (process.platform === "win32") {
    try {
      execSync("where wt.exe", { stdio: "ignore" })
      return "windows-terminal"
    } catch {
      return "powershell"
    }
  }
  try {
    execSync("which tmux", { stdio: "ignore" })
    return "tmux"
  } catch {
    return "unsupported"
  }
}

function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX)
}

// ─── Pane management ─────────────────────────────────────────────────────────

// Maps sessionID -> pane/process identifier for cleanup
const openPanes = new Map<string, string>()

function attachCmd(serverUrl: URL, sessionID: string): string {
  const base = serverUrl.origin
  return `hopcoderx attach --server ${base} --session ${sessionID}`
}

function spawnTmuxPane(sessionID: string, cmd: string, cfg: TmuxConfig): void {
  if (!isInsideTmux()) {
    // Start a new tmux session and run the attach command there
    spawn("tmux", ["new-session", "-d", "-s", `hcx-${sessionID.slice(0, 8)}`, cmd], { stdio: "ignore" }).unref()
    openPanes.set(sessionID, `hcx-${sessionID.slice(0, 8)}`)
    return
  }
  // We're already in tmux – split the current pane
  const sizeFlag = cfg.main_pane_size ? ["-p", String(100 - cfg.main_pane_size)] : []
  const proc = spawn("tmux", ["split-window", "-v", "-d", ...sizeFlag, cmd], { stdio: "ignore" })
  proc.unref()
  // Store the pane id so we can close it later
  try {
    const paneId = execSync("tmux display-message -p '#{pane_id}'", { encoding: "utf8" }).trim()
    openPanes.set(sessionID, paneId)
  } catch {
    // Couldn't get pane id – auto_close will be skipped for this session
  }
  // Apply layout
  try {
    execSync(`tmux select-layout ${cfg.layout}`, { stdio: "ignore" })
  } catch {
    // Layout might not be valid – silently ignore
  }
}

function closeTmuxPane(sessionID: string): void {
  const target = openPanes.get(sessionID)
  if (!target) return
  openPanes.delete(sessionID)
  try {
    if (target.startsWith("hcx-")) {
      execSync(`tmux kill-session -t ${target}`, { stdio: "ignore" })
    } else {
      execSync(`tmux kill-pane -t ${target}`, { stdio: "ignore" })
    }
  } catch {
    // Pane may already be closed
  }
}

function spawnWindowsTerminalPane(sessionID: string, cmd: string, _cfg: TmuxConfig): void {
  // wt new-tab runs in the existing Windows Terminal instance
  spawn("wt.exe", ["-w", "0", "sp", "--title", `HCX ${sessionID.slice(0, 8)}`, "pwsh", "-NoExit", "-Command", cmd], {
    stdio: "ignore",
    detached: true,
  }).unref()
  openPanes.set(sessionID, sessionID) // marker – we can't kill WT panes programmatically
}

function spawnPowershellPane(sessionID: string, cmd: string, _cfg: TmuxConfig): void {
  spawn("pwsh", ["-NoExit", "-Command", cmd], {
    stdio: "ignore",
    detached: true,
  }).unref()
  openPanes.set(sessionID, sessionID)
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const TmuxPlugin: Plugin = async (ctx): Promise<Hooks> => {
  const cfg = await loadConfig()
  if (!cfg.enabled) return {}

  const platform = detectPlatform()
  if (platform === "unsupported") return {}

  return {
    "session.start": async ({ sessionID }) => {
      try {
        const cmd = attachCmd(ctx.serverUrl, sessionID)
        switch (platform) {
          case "tmux":
            spawnTmuxPane(sessionID, cmd, cfg)
            break
          case "windows-terminal":
            spawnWindowsTerminalPane(sessionID, cmd, cfg)
            break
          case "powershell":
            spawnPowershellPane(sessionID, cmd, cfg)
            break
        }
      } catch {
        // Never crash the main session over pane management
      }
    },

    "session.end": async ({ sessionID }) => {
      if (!cfg.auto_close) return
      try {
        if (platform === "tmux") closeTmuxPane(sessionID)
        else openPanes.delete(sessionID)
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}

export default TmuxPlugin
