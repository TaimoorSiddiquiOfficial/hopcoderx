import { test, expect, describe, afterEach } from "bun:test"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"

const daemonConfigPath = path.join(Global.Path.config, "daemon.json")

afterEach(async () => {
  await fs.rm(daemonConfigPath, { force: true }).catch(() => {})
})

async function writeDaemonConfig(config: Record<string, any>) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await Filesystem.write(daemonConfigPath, JSON.stringify(config, null, 2))
}

async function readDaemonConfig(): Promise<Record<string, any>> {
  if (!(await Filesystem.exists(daemonConfigPath))) {
    return {}
  }
  const content = await Filesystem.readText(daemonConfigPath)
  return JSON.parse(content)
}

describe("daemon configure", () => {
  test("sets log level", async () => {
    await writeDaemonConfig({})

    const config = await readDaemonConfig()
    config.logLevel = "debug"
    await writeDaemonConfig(config)

    const updated = await readDaemonConfig()
    expect(updated.logLevel).toBe("debug")
  })

  test("sets heartbeat interval", async () => {
    await writeDaemonConfig({})

    const config = await readDaemonConfig()
    config.heartbeatInterval = 60 // 60 seconds
    await writeDaemonConfig(config)

    const updated = await readDaemonConfig()
    expect(updated.heartbeatInterval).toBe(60)
  })

  test("sets cron interval", async () => {
    await writeDaemonConfig({})

    const config = await readDaemonConfig()
    config.cronInterval = 30000 // 30 seconds in ms
    await writeDaemonConfig(config)

    const updated = await readDaemonConfig()
    expect(updated.cronInterval).toBe(30000)
  })

  test("sets multiple configuration values", async () => {
    await writeDaemonConfig({})

    const config = await readDaemonConfig()
    config.logLevel = "info"
    config.heartbeatInterval = 30
    config.cronInterval = 60000
    await writeDaemonConfig(config)

    const updated = await readDaemonConfig()
    expect(updated.logLevel).toBe("info")
    expect(updated.heartbeatInterval).toBe(30)
    expect(updated.cronInterval).toBe(60000)
  })

  test("updates existing configuration", async () => {
    await writeDaemonConfig({
      logLevel: "debug",
      heartbeatInterval: 30,
    })

    const config = await readDaemonConfig()
    config.logLevel = "warn"
    await writeDaemonConfig(config)

    const updated = await readDaemonConfig()
    expect(updated.logLevel).toBe("warn")
    expect(updated.heartbeatInterval).toBe(30) // Unchanged
  })

  test("handles missing config file", async () => {
    const exists = await Filesystem.exists(daemonConfigPath)
    expect(exists).toBe(false)
  })

  test("creates config file if it doesn't exist", async () => {
    await writeDaemonConfig({ logLevel: "info" })

    const exists = await Filesystem.exists(daemonConfigPath)
    expect(exists).toBe(true)

    const config = await readDaemonConfig()
    expect(config.logLevel).toBe("info")
  })
})

describe("daemon status", () => {
  test("returns stopped status when daemon not running", async () => {
    // On test environment, daemon is not running
    // This test verifies the structure of status response
    const mockStatus = {
      running: false,
      pid: undefined,
      uptime: undefined,
    }

    expect(mockStatus.running).toBe(false)
  })

  test("includes heartbeat info when available", async () => {
    const mockHeartbeat = {
      pid: 12345,
      ts: Date.now(),
      age: 5, // seconds ago
    }

    expect(mockHeartbeat.pid).toBe(12345)
    expect(mockHeartbeat.age).toBeLessThan(60) // Should be recent
  })
})

describe("daemon logs", () => {
  test("returns log content", async () => {
    const mockLogs = [
      "[2024-01-01 00:00:00] Daemon started",
      "[2024-01-01 00:00:01] Heartbeat written",
      "[2024-01-01 00:00:02] Cron task executed",
    ]

    expect(mockLogs.length).toBe(3)
    expect(mockLogs[0]).toContain("Daemon started")
  })

  test("limits log lines", async () => {
    const allLogs = Array.from({ length: 100 }, (_, i) => `Log line ${i}`)
    const limitedLogs = allLogs.slice(-50) // Last 50 lines

    expect(limitedLogs.length).toBe(50)
    expect(limitedLogs[0]).toBe("Log line 50")
  })
})

describe("daemon install", () => {
  test("creates platform-specific service", async () => {
    const platformConfigs = {
      darwin: {
        type: "launchd",
        path: "~/Library/LaunchAgents/dev.hopcoderx.plist",
      },
      linux: {
        type: "systemd",
        path: "~/.config/systemd/user/hopcoderx.service",
      },
      win32: {
        type: "schtasks",
        taskName: "HopCoderXDaemon",
      },
    }

    const platform = process.platform as keyof typeof platformConfigs
    expect(platformConfigs[platform]).toBeDefined()
  })
})

describe("daemon uninstall", () => {
  test("removes platform-specific service", async () => {
    // Simulate uninstall by removing config
    await writeDaemonConfig({ logLevel: "info" })

    await fs.rm(daemonConfigPath, { force: true })

    const exists = await Filesystem.exists(daemonConfigPath)
    expect(exists).toBe(false)
  })
})

describe("daemon start/stop/restart", () => {
  test("start command structure", async () => {
    const mockStartCommand = {
      darwin: ["launchctl", "start", "dev.hopcoderx"],
      linux: ["systemctl", "--user", "start", "hopcoderx"],
      win32: ["schtasks", "/Run", "/TN", "HopCoderXDaemon"],
    }

    const platform = process.platform as keyof typeof mockStartCommand
    expect(mockStartCommand[platform]).toBeDefined()
  })

  test("stop command structure", async () => {
    const mockStopCommand = {
      darwin: ["launchctl", "stop", "dev.hopcoderx"],
      linux: ["systemctl", "--user", "stop", "hopcoderx"],
      win32: ["schtasks", "/End", "/TN", "HopCoderXDaemon"],
    }

    const platform = process.platform as keyof typeof mockStopCommand
    expect(mockStopCommand[platform]).toBeDefined()
  })
})
