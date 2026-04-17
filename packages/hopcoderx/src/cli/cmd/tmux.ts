/**
 * hopcoderx tmux — status and configuration for the hopcoderx-tmux plugin.
 *
 * CLI:
 *   hopcoderx tmux status   Show plugin state, platform, and config
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { execSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Global } from "../../global"

// ─── Config loader ─────────────────────────────────────────────────────────────

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
  const configFile = path.join(Global.Path.config, "opentmux.json")
  try {
    const raw = await fs.readFile(configFile, "utf8")
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

// ─── Platform helpers ──────────────────────────────────────────────────────────

function detectPlatform(): string {
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

function tmuxVersion(): string {
  try {
    return execSync("tmux -V", { encoding: "utf8" }).trim()
  } catch {
    return "not found"
  }
}

function isInsideTmux(): boolean {
  return Boolean(process.env.TMUX)
}

// ─── Command definition ────────────────────────────────────────────────────────

function statusCommand() {
  return cmd({
    command: "status",
    describe: "Show hopcoderx-tmux plugin status and configuration",
    handler: async () => {
      const cfg = await loadConfig()
      const platform = detectPlatform()

      console.log("\nhopcoderx-tmux status")
      console.log("─────────────────────────────────────")
      console.log(`  Plugin enabled    : ${cfg.enabled ? "yes" : "no (set enabled:true in opentmux.json)"}`)
      console.log(`  Detected platform : ${platform}`)
      console.log(`  Inside tmux       : ${isInsideTmux() ? "yes" : "no"}`)
      if (platform === "tmux") {
        console.log(`  Tmux version      : ${tmuxVersion()}`)
      }
      console.log("")
      console.log("  Configuration")
      console.log(`    layout          : ${cfg.layout}`)
      console.log(`    main_pane_size  : ${cfg.main_pane_size}%`)
      console.log(`    auto_close      : ${cfg.auto_close ? "yes" : "no"}`)
      if (cfg.port) console.log(`    port            : ${cfg.port}`)
      console.log("")
      console.log(`  Config file       : ${path.join(Global.Path.config, "opentmux.json")}`)

      if (platform === "unsupported") {
        console.log("\n  ⚠  tmux not found. Install it with:  brew install tmux  or  apt install tmux")
      }
      if (!cfg.enabled) {
        console.log('\n  ⚠  Plugin is disabled. Set "enabled": true in opentmux.json to activate.')
      }
      console.log("")
    },
  } as const)
}

export const TmuxCommand = cmd({
  command: "tmux <subcommand>",
  describe: "Manage hopcoderx-tmux terminal integration",
  builder: (yargs: Argv) =>
    yargs.command(statusCommand() as any).demandCommand(1, "Please specify a subcommand: status"),
  handler: async () => {},
} as const)
