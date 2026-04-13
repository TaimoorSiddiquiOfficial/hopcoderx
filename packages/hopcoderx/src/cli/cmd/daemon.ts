/**
 * HopCoderX daemon — background agent service.
 *
 * Installs as a system service that starts on login:
 *   macOS   → launchd plist  (~Library/LaunchAgents/dev.hopcoderx.plist)
 *   Linux   → systemd user unit (~/.config/systemd/user/hopcoderx.service)
 *   Windows → Task Scheduler task (schtasks)
 *
 * CLI: `hopcoderx daemon install|uninstall|start|stop|restart|status|logs`
 */

import { execFile, spawn } from "child_process"
import { promisify } from "util"
import { join, dirname } from "path"
import { homedir, platform } from "os"
import { writeFile, readFile, mkdir, unlink } from "fs/promises"
import { existsSync } from "fs"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { Log } from "../../util/log"
import path from "path"

const log = Log.create({ service: "daemon" })

const execFileAsync = promisify(execFile)
const PLATFORM = platform()
const DAEMON_ID = "dev.hopcoderx"
const DAEMON_NAME = "hopcoderx"

// ─── Platform implementations ──────────────────────────────────────────────────

interface DaemonBackend {
  install(execPath: string): Promise<void>
  uninstall(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  status(): Promise<{ running: boolean; pid?: number; uptime?: string }>
  logs(lines?: number): Promise<string>
}

// ── macOS launchd ──────────────────────────────────────────────────────────────

class LaunchdBackend implements DaemonBackend {
  private plistPath = join(homedir(), "Library", "LaunchAgents", `${DAEMON_ID}.plist`)
  private logOut = join(Global.Path.data, "daemon.log")
  private logErr = join(Global.Path.data, "daemon-error.log")

  async install(execPath: string): Promise<void> {
    await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>daemon</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${this.logOut}</string>
  <key>StandardErrorPath</key>
  <string>${this.logErr}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOPCODERX_DAEMON</key>
    <string>1</string>
  </dict>
</dict>
</plist>`
    await writeFile(this.plistPath, plist, "utf8")
    await execFileAsync("launchctl", ["load", this.plistPath])
  }

  async uninstall(): Promise<void> {
    try { await execFileAsync("launchctl", ["unload", this.plistPath]) } catch {
      // Service may not be loaded
    }
    try { await unlink(this.plistPath) } catch {
      // File may not exist
    }
  }

  async start(): Promise<void> {
    await execFileAsync("launchctl", ["start", DAEMON_ID])
  }

  async stop(): Promise<void> {
    await execFileAsync("launchctl", ["stop", DAEMON_ID])
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async status(): Promise<{ running: boolean; pid?: number; uptime?: string }> {
    try {
      const { stdout } = await execFileAsync("launchctl", ["list", DAEMON_ID])
      const pidMatch = stdout.match(/"PID"\s*=\s*(\d+)/)
      const pid = pidMatch ? Number(pidMatch[1]) : undefined
      return { running: !!pid, pid }
    } catch {
      return { running: false }
    }
  }

  async logs(lines = 50): Promise<string> {
    try {
      const { stdout } = await execFileAsync("tail", ["-n", String(lines), this.logOut])
      return stdout
    } catch {
      return "(no logs)"
    }
  }
}

// ── Linux systemd ──────────────────────────────────────────────────────────────

class SystemdBackend implements DaemonBackend {
  private unitDir = join(homedir(), ".config", "systemd", "user")
  private unitFile = join(this.unitDir, `${DAEMON_NAME}.service`)
  private logPath = join(Global.Path.data, "daemon.log")

  async install(execPath: string): Promise<void> {
    await mkdir(this.unitDir, { recursive: true })
    const unit = `[Unit]
Description=HopCoderX background agent service
After=network.target

[Service]
Type=simple
ExecStart=${execPath} daemon serve
Restart=on-failure
RestartSec=5
Environment=HOPCODERX_DAEMON=1
StandardOutput=append:${this.logPath}
StandardError=append:${this.logPath}

[Install]
WantedBy=default.target
`
    await writeFile(this.unitFile, unit, "utf8")
    await execFileAsync("systemctl", ["--user", "daemon-reload"])
    await execFileAsync("systemctl", ["--user", "enable", DAEMON_NAME])
    await execFileAsync("systemctl", ["--user", "start", DAEMON_NAME])
  }

  async uninstall(): Promise<void> {
    try { await execFileAsync("systemctl", ["--user", "stop", DAEMON_NAME]) } catch {
      // Service may not be running
    }
    try { await execFileAsync("systemctl", ["--user", "disable", DAEMON_NAME]) } catch {
      // Service may not be enabled
    }
    try { await unlink(this.unitFile) } catch {
      // File may not exist
    }
    try { await execFileAsync("systemctl", ["--user", "daemon-reload"]) } catch {
      // systemctl may not be available
    }
  }

  async start(): Promise<void> {
    await execFileAsync("systemctl", ["--user", "start", DAEMON_NAME])
  }

  async stop(): Promise<void> {
    await execFileAsync("systemctl", ["--user", "stop", DAEMON_NAME])
  }

  async restart(): Promise<void> {
    await execFileAsync("systemctl", ["--user", "restart", DAEMON_NAME])
  }

  async status(): Promise<{ running: boolean; pid?: number; uptime?: string }> {
    try {
      const { stdout } = await execFileAsync("systemctl", ["--user", "show", DAEMON_NAME,
        "--property=ActiveState,MainPID,ActiveEnterTimestamp"])
      const active = stdout.includes("ActiveState=active")
      const pidMatch = stdout.match(/MainPID=(\d+)/)
      const pid = pidMatch ? Number(pidMatch[1]) : undefined
      const tsMatch = stdout.match(/ActiveEnterTimestamp=(.+)/)
      return { running: active, pid: pid !== 0 ? pid : undefined, uptime: tsMatch?.[1] }
    } catch {
      return { running: false }
    }
  }

  async logs(lines = 50): Promise<string> {
    try {
      const { stdout } = await execFileAsync("journalctl", ["--user", "-u", DAEMON_NAME, "-n", String(lines), "--no-pager"])
      return stdout
    } catch {
      try {
        const { stdout } = await execFileAsync("tail", ["-n", String(lines), this.logPath])
        return stdout
      } catch {
        return "(no logs)"
      }
    }
  }
}

// ── Windows Task Scheduler ─────────────────────────────────────────────────────

class WindowsTaskBackend implements DaemonBackend {
  private taskName = "HopCoderXDaemon"
  private logPath = join(Global.Path.data, "daemon.log")

  async install(execPath: string): Promise<void> {
    // Create task that runs at login and on system start
    await execFileAsync("schtasks", [
      "/Create", "/F",
      "/TN", this.taskName,
      "/TR", `"${execPath}" daemon serve`,
      "/SC", "ONLOGON",
      "/RU", process.env.USERNAME ?? "%USERNAME%",
      "/RL", "LIMITED",
    ])
  }

  async uninstall(): Promise<void> {
    try { await execFileAsync("schtasks", ["/Delete", "/F", "/TN", this.taskName]) } catch {
      // Task may not exist
    }
  }

  async start(): Promise<void> {
    await execFileAsync("schtasks", ["/Run", "/TN", this.taskName])
  }

  async stop(): Promise<void> {
    await execFileAsync("schtasks", ["/End", "/TN", this.taskName])
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async status(): Promise<{ running: boolean; pid?: number; uptime?: string }> {
    try {
      const { stdout } = await execFileAsync("schtasks", ["/Query", "/TN", this.taskName, "/FO", "LIST"])
      const running = stdout.includes("Status:") && (stdout.includes("Running") || stdout.includes("Ready"))
      return { running }
    } catch {
      return { running: false }
    }
  }

  async logs(lines = 50): Promise<string> {
    try {
      const fs = require("fs") as typeof import("fs")
      const raw = fs.readFileSync(this.logPath, "utf8")
      return raw.split("\n").slice(-lines).join("\n")
    } catch {
      return "(no logs)"
    }
  }
}

// ─── Backend selector ──────────────────────────────────────────────────────────

function getBackend(): DaemonBackend {
  if (PLATFORM === "darwin") return new LaunchdBackend()
  if (PLATFORM === "win32") return new WindowsTaskBackend()
  return new SystemdBackend()
}

function getExecPath(): string {
  // The currently running hopcoderx binary
  return process.execPath === process.argv[0]
    ? process.argv[1] ?? "hopcoderx"
    : process.argv[1] ?? "hopcoderx"
}

// ─── CLI command ────────────────────────────────────────────────────────────────

export const DaemonConfigureCommand = cmd({
  command: "configure",
  describe: "configure daemon settings",
  builder: (yargs: Argv) =>
    yargs
      .option("log-level", {
        type: "string",
        describe: "log level (debug, info, warn, error)",
        choices: ["debug", "info", "warn", "error"],
      })
      .option("heartbeat-interval", {
        type: "number",
        describe: "heartbeat interval in seconds",
        default: 30,
      })
      .option("cron-interval", {
        type: "number",
        describe: "cron task check interval in milliseconds",
        default: 60000,
      }),
  handler: async (args) => {
    const configPath = path.join(Global.Path.config, "daemon.json")
    let config: Record<string, any> = {}

    try {
      const raw = await readFile(configPath, "utf8")
      config = JSON.parse(raw)
    } catch {
      // Config doesn't exist yet
    }

    if (args.logLevel) config.logLevel = args.logLevel
    if (args.heartbeatInterval) config.heartbeatInterval = args.heartbeatInterval
    if (args.cronInterval) config.cronInterval = args.cronInterval

    await mkdir(path.dirname(configPath), { recursive: true })
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8")

    console.log("✅ Daemon configuration updated:")
    for (const [key, value] of Object.entries(config)) {
      console.log(`   ${key}: ${value}`)
    }
  },
})

export const DaemonCommand = cmd({
  command: "daemon [action]",
  describe: "Background agent service (install/start/stop/status/logs)",
  builder: (yargs: Argv) =>
    yargs
      .command(DaemonConfigureCommand)
      .positional("action", {
        type: "string",
        choices: ["install", "uninstall", "start", "stop", "restart", "status", "logs", "serve", "configure"] as const,
        default: "status",
      })
      .option("lines", { type: "number", description: "Log lines to show", default: 50 }),
  handler: async (args: { action?: string; lines?: number }) => {
    const action = args.action ?? "status"

    // "serve" is internal — called by the daemon process itself
    if (action === "serve") {
      process.title = "hopcoderx-daemon"
      console.log(`[HopCoderX Daemon] started pid=${process.pid}`)

      // Start canvas host server
      try {
        const { startCanvasHost } = await import("../../canvas/host")
        const host = await startCanvasHost()
        console.log(`[HopCoderX Daemon] canvas host started on port ${host.port} (root: ${host.rootDir})`)
      } catch (e) {
        console.warn("[HopCoderX Daemon] canvas host failed to start:", e instanceof Error ? e.message : e)
      }

      // Heartbeat — daemon stays alive and processes background jobs
      setInterval(() => {
        try {
          const fs = require("fs") as typeof import("fs")
          fs.mkdirSync(Global.Path.data, { recursive: true })
          fs.writeFileSync(join(Global.Path.data, "daemon.heartbeat"), JSON.stringify({
            pid: process.pid,
            ts: Date.now(),
          }))
        } catch (err) {
          log.warn("Failed to write heartbeat", { error: String(err) })
        }
      }, 30_000)

      // Cron runner — execute due tasks every minute
      setInterval(async () => {
        try {
          const { executeDueTasks } = await import("./cron")
          await executeDueTasks()
        } catch (err) {
          log.error("Cron task execution failed", { error: String(err) })
        }
      }, 60_000)
      return
    }

    const backend = getBackend()

    switch (action) {
      case "install": {
        const exec = getExecPath()
        console.log(`Installing HopCoderX daemon (${PLATFORM})…`)
        await backend.install(exec)
        console.log("✅ Daemon installed and started.")
        console.log("   Run `hopcoderx daemon status` to verify.")
        break
      }

      case "uninstall": {
        await backend.uninstall()
        console.log("✅ Daemon uninstalled.")
        break
      }

      case "start":
        await backend.start()
        console.log("✅ Daemon started.")
        break

      case "stop":
        await backend.stop()
        console.log("✅ Daemon stopped.")
        break

      case "restart":
        await backend.restart()
        console.log("✅ Daemon restarted.")
        break

      case "status": {
        const s = await backend.status()
        console.log("\n🤖 HopCoderX Daemon\n")
        console.log(`  Status : ${s.running ? "🟢 running" : "🔴 stopped"}`)
        if (s.pid) console.log(`  PID    : ${s.pid}`)
        if (s.uptime) console.log(`  Since  : ${s.uptime}`)
        const heartbeatFile = join(Global.Path.data, "daemon.heartbeat")
        if (existsSync(heartbeatFile)) {
          try {
            const hb = JSON.parse(require("fs").readFileSync(heartbeatFile, "utf8"))
            const age = Math.round((Date.now() - hb.ts) / 1000)
            console.log(`  Last heartbeat: ${age}s ago (pid=${hb.pid})`)
          } catch (err) {
            log.warn("Failed to read heartbeat file", { error: String(err) })
          }
        }
        break
      }

      case "logs": {
        const out = await backend.logs(args.lines ?? 50)
        console.log(out)
        break
      }

      default:
        console.error(`Unknown action: ${action}`)
        process.exit(1)
    }
  },
})
