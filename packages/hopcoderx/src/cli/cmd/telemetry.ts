import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import path from "path"
import { Global } from "../../global"
import { getTelemetryData, clearTelemetryData } from "../../telemetry/storage"

interface TelemetryConfig {
  telemetry?: boolean
}

type ConfigWithTelemetry = Config.Info & TelemetryConfig

export const TelemetryCommand = cmd({
  command: "telemetry",
  describe: "view and manage telemetry settings",
  builder: (yargs: Argv) =>
    yargs
      .command(TelemetryStatusCommand)
      .command(TelemetryEnableCommand)
      .command(TelemetryDisableCommand)
      .command(TelemetryDataCommand)
      .command(TelemetryClearCommand)
      .demandCommand(),
  async handler() {},
})

export const TelemetryStatusCommand = cmd({
  command: "status",
  describe: "show current telemetry status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Telemetry Status")

        const config = await Config.get() as ConfigWithTelemetry
        const telemetryEnabled = config.telemetry !== false

        if (telemetryEnabled) {
          prompts.log.info(`${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} Telemetry is ${UI.Style.TEXT_SUCCESS}enabled${UI.Style.TEXT_NORMAL}`)
          prompts.log.info("\nHopCoderX collects anonymous usage data to improve the product.")
          prompts.log.info("You can disable telemetry at any time with: hopcoderx telemetry disable")
        } else {
          prompts.log.info(`${UI.Style.TEXT_WARNING}⚠${UI.Style.TEXT_NORMAL} Telemetry is ${UI.Style.TEXT_WARNING}disabled${UI.Style.TEXT_NORMAL}`)
          prompts.log.info("\nTelemetry collection is currently disabled.")
          prompts.log.info("You can enable telemetry with: hopcoderx telemetry enable")
        }

        prompts.outro("Done")
      },
    })
  },
})

export const TelemetryEnableCommand = cmd({
  command: "enable",
  describe: "enable telemetry collection",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Enable Telemetry")

        const configPath = path.join(Global.Path.config, "hopcoderx.json")
        let configContent = "{}"

        if (await Filesystem.exists(configPath)) {
          configContent = await Filesystem.readText(configPath)
        }

        let config: any
        try {
          config = JSON.parse(configContent)
        } catch {
          config = {}
        }

        config.telemetry = true

        await Filesystem.write(configPath, JSON.stringify(config, null, 2))

        prompts.log.success("Telemetry enabled")
        prompts.log.info("Thank you for helping us improve HopCoderX!")
        prompts.outro("Done")
      },
    })
  },
})

export const TelemetryDisableCommand = cmd({
  command: "disable",
  describe: "disable telemetry collection",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Disable Telemetry")

        const configPath = path.join(Global.Path.config, "hopcoderx.json")
        let configContent = "{}"

        if (await Filesystem.exists(configPath)) {
          configContent = await Filesystem.readText(configPath)
        }

        let config: any
        try {
          config = JSON.parse(configContent)
        } catch {
          config = {}
        }

        config.telemetry = false

        await Filesystem.write(configPath, JSON.stringify(config, null, 2))

        prompts.log.success("Telemetry disabled")
        prompts.log.info("You can re-enable telemetry at any time with: hopcoderx telemetry enable")
        prompts.outro("Done")
      },
    })
  },
})

export const TelemetryDataCommand = cmd({
  command: "data",
  describe: "view collected telemetry data",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "output as JSON",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const config = await Config.get() as ConfigWithTelemetry
        const telemetryEnabled = config.telemetry !== false

        if (!telemetryEnabled) {
          if (args.json) {
            process.stdout.write(JSON.stringify({ enabled: false, data: [] }) + "\n")
            return
          }

          UI.empty()
          prompts.intro("Telemetry Data")
          prompts.log.warn("Telemetry is disabled - no data is being collected")
          prompts.outro("Done")
          return
        }

        // Get actual telemetry data
        const events = await getTelemetryData()

        if (args.json) {
          process.stdout.write(JSON.stringify({ enabled: true, events }, null, 2) + "\n")
          return
        }

        UI.empty()
        prompts.intro("Telemetry Data")

        if (events.length === 0) {
          prompts.log.info("No telemetry events collected yet")
          prompts.log.info("\nHopCoderX collects the following anonymous usage data:")
          prompts.log.info("  • Command usage (which commands are run, not their arguments)")
          prompts.log.info("  • Session duration")
          prompts.log.info("  • Model provider selection (not prompts or responses)")
          prompts.log.info("  • Error rates and crash reports")
          prompts.log.info("  • Feature adoption metrics")
          prompts.log.info("\nWe do NOT collect:")
          prompts.log.info("  • Source code or file contents")
          prompts.log.info("  • API keys or credentials")
          prompts.log.info("  • Prompts sent to AI models")
          prompts.log.info("  • AI model responses")
          prompts.log.info("  • Personal or sensitive information")
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Found ${events.length} telemetry event(s):\n`)
        for (const event of events.slice(-10)) {
          // Show last 10 events
          prompts.log.info(`  ${UI.Style.TEXT_DIM}${event.timestamp}${UI.Style.TEXT_NORMAL} ${event.event}`)
          if (event.properties && Object.keys(event.properties).length > 0) {
            prompts.log.info(`    ${UI.Style.TEXT_DIM}${JSON.stringify(event.properties)}${UI.Style.TEXT_NORMAL}`)
          }
        }

        if (events.length > 10) {
          prompts.log.info(`\n  ... and ${events.length - 10} more events`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const TelemetryClearCommand = cmd({
  command: "clear",
  describe: "clear all stored telemetry data",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Clear Telemetry Data")

        const confirm = await prompts.confirm({
          message: "Are you sure you want to clear all telemetry data?",
          initialValue: false,
        })

        if (prompts.isCancel(confirm) || !confirm) {
          prompts.outro("Cancelled")
          return
        }

        await clearTelemetryData()

        prompts.log.success("All telemetry data has been cleared")
        prompts.outro("Done")
      },
    })
  },
})
