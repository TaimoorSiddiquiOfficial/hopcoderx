import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import path from "path"
import { Global } from "../../global"

export const TelemetryCommand = cmd({
  command: "telemetry",
  describe: "view and manage telemetry settings",
  builder: (yargs: Argv) =>
    yargs
      .command(TelemetryStatusCommand)
      .command(TelemetryEnableCommand)
      .command(TelemetryDisableCommand)
      .command(TelemetryDataCommand)
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

        const config = await Config.get()
        const telemetryEnabled = (config as any).telemetry !== false

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
        const config = await Config.get()
        const telemetryEnabled = (config as any).telemetry !== false

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

        // Note: Actual telemetry data storage and retrieval would be implemented here
        // For now, we show what types of data would be collected

        const telemetryInfo = {
          enabled: true,
          description: "HopCoderX collects the following anonymous usage data:",
          dataTypes: [
            "Command usage (which commands are run, not their arguments)",
            "Session duration",
            "Model provider selection (not prompts or responses)",
            "Error rates and crash reports",
            "Feature adoption metrics",
          ],
          notCollected: [
            "Source code or file contents",
            "API keys or credentials",
            "Prompts sent to AI models",
            "AI model responses",
            "Personal or sensitive information",
          ],
        }

        if (args.json) {
          process.stdout.write(JSON.stringify(telemetryInfo, null, 2) + "\n")
          return
        }

        UI.empty()
        prompts.intro("Telemetry Data")

        prompts.log.info("\nHopCoderX collects the following anonymous usage data:")
        for (const item of telemetryInfo.dataTypes) {
          prompts.log.info(`  ✓ ${item}`)
        }

        prompts.log.info("\nWe do NOT collect:")
        for (const item of telemetryInfo.notCollected) {
          prompts.log.info(`  ✗ ${item}`)
        }

        prompts.log.info("\nFor more details, see our privacy policy at:")
        prompts.log.info("  https://hopcoder.dev/legal/privacy-policy")

        prompts.outro("Done")
      },
    })
  },
})
