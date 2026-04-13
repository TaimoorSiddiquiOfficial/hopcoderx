import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Global } from "../../global"
import path from "path"
import { Filesystem } from "../../util/filesystem"
import { modify, applyEdits } from "jsonc-parser"
import open from "open"

export const ConfigCommand = cmd({
  command: "config",
  describe: "view and edit HopCoderX configuration",
  builder: (yargs: Argv) =>
    yargs
      .command(ConfigGetCommand)
      .command(ConfigSetCommand)
      .command(ConfigEditCommand)
      .command(ConfigValidateCommand)
      .command(ConfigListCommand)
      .demandCommand(),
  async handler() {},
})

export const ConfigGetCommand = cmd({
  command: "get <key>",
  describe: "get a configuration value",
  builder: (yargs: Argv) =>
    yargs.positional("key", {
      describe: "configuration key (e.g., model, provider.anthropic, agent.build)",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Config Get")

        const config = await Config.get()
        const keys = args.key.split(".")
        let value: any = config

        for (const key of keys) {
          if (value === undefined || value === null) {
            prompts.log.error(`Key not found: ${args.key}`)
            prompts.outro("Done")
            return
          }
          value = value[key]
        }

        if (value === undefined) {
          prompts.log.warn(`Configuration key not set: ${args.key}`)
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Value:\n${JSON.stringify(value, null, 2)}`)
        prompts.outro("Done")
      },
    })
  },
})

export const ConfigSetCommand = cmd({
  command: "set <key> <value>",
  describe: "set a configuration value",
  builder: (yargs: Argv) =>
    yargs
      .positional("key", {
        describe: "configuration key (e.g., model, provider.anthropic.apiKey)",
        type: "string",
        demandOption: true,
      })
      .positional("value", {
        describe: "value to set (JSON-parsed if valid JSON, otherwise string)",
        type: "string",
        demandOption: true,
      })
      .option("global", {
        type: "boolean",
        describe: "set in global config instead of project config",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Config Set")

        // Parse value - try JSON first, fall back to string
        let parsedValue: any
        try {
          parsedValue = JSON.parse(args.value)
        } catch {
          // Not valid JSON, use as string
          parsedValue = args.value
        }

        // Determine config file path
        const configPath = args.global
          ? path.join(Global.Path.config, "hopcoderx.json")
          : path.join(Instance.worktree, "hopcoderx.json")

        // Read existing config or create new
        let configContent = "{}"
        if (await Filesystem.exists(configPath)) {
          configContent = await Filesystem.readText(configPath)
        }

        // Build nested object path
        const keys = args.key.split(".")
        const edits = modify(configContent, keys, parsedValue, {
          formattingOptions: { tabSize: 2, insertSpaces: true },
        })

        if (edits.length === 0) {
          prompts.log.error("Failed to create edit operations")
          prompts.outro("Done")
          return
        }

        const result = applyEdits(configContent, edits)
        await Filesystem.write(configPath, result)

        prompts.log.success(`Set ${args.key} = ${JSON.stringify(parsedValue)}`)
        prompts.log.info(`in ${configPath}`)
        prompts.outro("Done")
      },
    })
  },
})

export const ConfigEditCommand = cmd({
  command: "edit",
  describe: "open configuration file in editor",
  builder: (yargs: Argv) =>
    yargs.option("global", {
      type: "boolean",
      describe: "open global config instead of project config",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Config Edit")

        const configPath = args.global
          ? path.join(Global.Path.config, "hopcoderx.json")
          : path.join(Instance.worktree, "hopcoderx.json")

        if (!(await Filesystem.exists(configPath))) {
          // Create empty config file
          const template = {
            $schema: "https://hopcoder.dev/config.json",
            model: "anthropic/claude-sonnet-4-5-20250929",
          }
          await Filesystem.write(configPath, JSON.stringify(template, null, 2))
          prompts.log.info(`Created new config file: ${configPath}`)
        }

        try {
          await open(configPath)
          prompts.log.success(`Opened: ${configPath}`)
        } catch (error) {
          prompts.log.error(`Failed to open editor: ${error instanceof Error ? error.message : String(error)}`)
          prompts.log.info(`Manual edit: ${configPath}`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const ConfigValidateCommand = cmd({
  command: "validate",
  describe: "validate configuration file",
  builder: (yargs: Argv) =>
    yargs.option("global", {
      type: "boolean",
      describe: "validate global config instead of project config",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Config Validate")

        const configPath = args.global
          ? path.join(Global.Path.config, "hopcoderx.json")
          : path.join(Instance.worktree, "hopcoderx.json")

        if (!(await Filesystem.exists(configPath))) {
          prompts.log.warn(`Config file not found: ${configPath}`)
          prompts.outro("Done")
          return
        }

        try {
          const content = await Filesystem.readText(configPath)
          const config = JSON.parse(content)

          // Basic validation - check for required fields and types
          const errors: string[] = []

          if (config.model && typeof config.model !== "string") {
            errors.push("'model' must be a string")
          }

          if (config.provider && typeof config.provider !== "object") {
            errors.push("'provider' must be an object")
          }

          if (config.agent && typeof config.agent !== "object") {
            errors.push("'agent' must be an object")
          }

          if (config.mcp && typeof config.mcp !== "object") {
            errors.push("'mcp' must be an object")
          }

          if (errors.length > 0) {
            prompts.log.error("Validation failed:")
            for (const error of errors) {
              prompts.log.info(`  - ${error}`)
            }
            prompts.outro("Fix the errors above")
            process.exitCode = 1
            return
          }

          prompts.log.success("Configuration is valid")
        } catch (error) {
          prompts.log.error(`Validation failed: ${error instanceof Error ? error.message : String(error)}`)
          process.exitCode = 1
        }

        prompts.outro("Done")
      },
    })
  },
})

export const ConfigListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all configuration values",
  builder: (yargs: Argv) =>
    yargs
      .option("global", {
        type: "boolean",
        describe: "show global config only",
        default: false,
      })
      .option("json", {
        type: "boolean",
        describe: "output as JSON",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (args.json) {
          const config = await Config.get()
          process.stdout.write(JSON.stringify(config, null, 2) + "\n")
          return
        }

        UI.empty()
        prompts.intro("Config List")

        const config = await Config.get()

        // Display config in sections
        const sections = [
          { key: "model", label: "Model" },
          { key: "provider", label: "Providers" },
          { key: "agent", label: "Agents" },
          { key: "mcp", label: "MCP Servers" },
          { key: "permission", label: "Permissions" },
          { key: "instructions", label: "Instructions" },
          { key: "plugin", label: "Plugins" },
        ]

        const configRecord = config as Record<string, unknown>
        for (const { key, label } of sections) {
          const value = configRecord[key]
          if (value === undefined || value === null) continue

          if (typeof value === "object" && !Array.isArray(value)) {
            prompts.log.info(`${label}:`)
            for (const [subKey, subValue] of Object.entries(value)) {
              prompts.log.info(`  ${subKey}: ${JSON.stringify(subValue)}`)
            }
          } else if (Array.isArray(value)) {
            prompts.log.info(`${label}:`)
            for (const item of value) {
              prompts.log.info(`  - ${JSON.stringify(item)}`)
            }
          } else {
            prompts.log.info(`${label}: ${JSON.stringify(value)}`)
          }
        }

        prompts.outro(`Total: ${Object.keys(config).length} configuration keys`)
      },
    })
  },
})
