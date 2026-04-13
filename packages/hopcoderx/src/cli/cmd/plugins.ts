import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import path from "path"
import { Global } from "../../global"
import { modify, applyEdits } from "jsonc-parser"
import { exec } from "child_process"
import { promisify } from "util"
import { Log } from "../../util/log"
const execAsync = promisify(exec)

interface PluginConfig {
  plugins?: string[]
  disabledPlugins?: (string | unknown)[]
}

type ConfigWithPlugins = Config.Info & PluginConfig

export const PluginsCommand = cmd({
  command: "plugins",
  aliases: ["plugin", "plug"],
  describe: "manage HopCoderX plugins",
  builder: (yargs: Argv) =>
    yargs
      .command(PluginsListCommand)
      .command(PluginsInstallCommand)
      .command(PluginsUninstallCommand)
      .command(PluginsEnableCommand)
      .command(PluginsDisableCommand)
      .demandCommand(),
  async handler() {},
})

export const PluginsListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list installed plugins",
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
        const config = await Config.get() as ConfigWithPlugins
        const plugins = config.plugins ?? []

        if (args.json) {
          process.stdout.write(JSON.stringify({ plugins }, null, 2) + "\n")
          return
        }

        UI.empty()
        prompts.intro("Installed Plugins")

        if (plugins.length === 0) {
          prompts.log.info("No plugins installed")
          prompts.log.info("Install a plugin with: hopcoderx plugins install <plugin-name>")
        } else {
          prompts.log.info(`Found ${plugins.length} plugin(s):`)
          for (const plugin of plugins) {
            prompts.log.info(`  • ${plugin}`)
          }
        }

        prompts.outro("Done")
      },
    })
  },
})

export const PluginsInstallCommand = cmd({
  command: "install <plugin>",
  aliases: ["add", "i"],
  describe: "install a plugin",
  builder: (yargs: Argv) =>
    yargs.option("global", {
      type: "boolean",
      describe: "install globally instead of project-local",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(`Installing Plugin: ${args.plugin}`)

        const configPath = args.global
          ? path.join(Global.Path.config, "hopcoderx.json")
          : path.join(process.cwd(), "hopcoderx.json")

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

        const plugins = config.plugins || []
        if (plugins.includes(args.plugin)) {
          prompts.log.info(`${args.plugin} is already installed`)
          prompts.outro("Done")
          return
        }

        const spinner = prompts.spinner()
        spinner.start(`Installing ${args.plugin}`)

        try {
          // Run bun add to install the plugin
          const command = `bun add ${args.plugin}${args.global ? " --global" : ""}`
          await execAsync(command, { cwd: process.cwd() })

          // Update config after successful install
          plugins.push(args.plugin)
          config.plugins = plugins

          const edits = modify(configContent, ["plugins"], plugins, {
            formattingOptions: { tabSize: 2, insertSpaces: true },
          })

          if (edits.length > 0) {
            const result = applyEdits(configContent, edits)
            await Filesystem.write(configPath, result)
          }

          spinner.stop()
          prompts.log.success(`Plugin ${args.plugin} installed successfully`)
          prompts.log.info(`Edit ${configPath} to configure the plugin`)
          prompts.outro("Done")
        } catch (error) {
          spinner.stop()
          prompts.log.error(`Failed to install plugin: ${error instanceof Error ? error.message : String(error)}`)
          prompts.outro("Failed")
        }
      },
    })
  },
})

export const PluginsUninstallCommand = cmd({
  command: "uninstall <plugin>",
  aliases: ["remove", "rm", "uninstall"],
  describe: "uninstall a plugin",
  builder: (yargs: Argv) =>
    yargs
      .option("global", {
        type: "boolean",
        describe: "uninstall from global config",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "preview changes without applying",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(`Uninstalling Plugin: ${args.plugin}`)

        const configPath = args.global
          ? path.join(Global.Path.config, "hopcoderx.json")
          : path.join(process.cwd(), "hopcoderx.json")

        if (!(await Filesystem.exists(configPath))) {
          prompts.log.error("Configuration file not found")
          prompts.outro("Done")
          return
        }

        const configContent = await Filesystem.readText(configPath)
        let config: any
        try {
          config = JSON.parse(configContent)
        } catch {
          prompts.log.error("Invalid configuration file")
          prompts.outro("Done")
          return
        }

        const plugins = config.plugins || []
        if (!plugins.includes(args.plugin)) {
          prompts.log.warn(`${args.plugin} is not installed`)
          prompts.outro("Done")
          return
        }

        if (args.dryRun) {
          prompts.log.info("Dry run - changes preview:")
          prompts.log.info(`  Removing: ${args.plugin}`)
          prompts.log.info(`  Config: ${configPath}`)
          prompts.outro("Dry run complete")
          return
        }

        const spinner = prompts.spinner()
        spinner.start(`Uninstalling ${args.plugin}`)

        try {
          // Run bun remove to uninstall the plugin
          const command = `bun remove ${args.plugin}${args.global ? " --global" : ""}`
          await execAsync(command, { cwd: process.cwd() })

          // Update config after successful uninstall
          const index = plugins.indexOf(args.plugin)
          if (index > -1) {
            plugins.splice(index, 1)
          }
          config.plugins = plugins

          const edits = modify(configContent, ["plugins"], plugins, {
            formattingOptions: { tabSize: 2, insertSpaces: true },
          })

          if (edits.length > 0) {
            const result = applyEdits(configContent, edits)
            await Filesystem.write(configPath, result)
          }

          spinner.stop()
          prompts.log.success(`Plugin ${args.plugin} uninstalled successfully`)
          prompts.outro("Done")
        } catch (error) {
          spinner.stop()
          prompts.log.error(`Failed to uninstall plugin: ${error instanceof Error ? error.message : String(error)}`)
          prompts.outro("Failed")
        }
      },
    })
  },
})

export const PluginsEnableCommand = cmd({
  command: "enable <plugin>",
  aliases: ["on"],
  describe: "enable a disabled plugin",
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(`Enabling Plugin: ${args.plugin}`)

        const config = await Config.get() as ConfigWithPlugins
        const disabledPlugins: string[] = (config.disabledPlugins ?? []).filter((p): p is string => typeof p === "string")
        const index = disabledPlugins.indexOf(args.plugin as string)

        if (index === -1) {
          prompts.log.info(`${args.plugin} is already enabled`)
          prompts.outro("Done")
          return
        }

        disabledPlugins.splice(index, 1)
        config.disabledPlugins = disabledPlugins

        await Config.update(config)

        prompts.log.success(`Plugin ${args.plugin} enabled`)
        prompts.outro("Done")
      },
    })
  },
})

export const PluginsDisableCommand = cmd({
  command: "disable <plugin>",
  aliases: ["off"],
  describe: "disable a plugin without uninstalling",
  builder: (yargs: Argv) =>
    yargs.option("dry-run", {
      type: "boolean",
      describe: "preview changes without applying",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro(`Disabling Plugin: ${args.plugin}`)

        const config = await Config.get() as ConfigWithPlugins
        const plugins: string[] = config.plugins ?? []
        const disabledPlugins: string[] = (config.disabledPlugins ?? []).filter((p): p is string => typeof p === "string")
        const pluginName = args.plugin as string

        if (!plugins.includes(pluginName)) {
          prompts.log.warn(`${pluginName} is not installed`)
          prompts.outro("Done")
          return
        }

        if (disabledPlugins.includes(pluginName)) {
          prompts.log.info(`${pluginName} is already disabled`)
          prompts.outro("Done")
          return
        }

        if (args.dryRun) {
          prompts.log.info("Dry run - changes preview:")
          prompts.log.info(`  Disabling: ${pluginName}`)
          prompts.outro("Dry run complete")
          return
        }

        disabledPlugins.push(pluginName)
        config.disabledPlugins = disabledPlugins

        await Config.update(config)

        prompts.log.success(`Plugin ${args.plugin} disabled`)
        prompts.outro("Done")
      },
    })
  },
})
