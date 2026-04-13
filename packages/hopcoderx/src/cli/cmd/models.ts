import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import * as prompts from "@clack/prompts"
import { Config } from "../../config/config"
import { Global } from "../../global"
import path from "path"
import { Filesystem } from "../../util/filesystem"
import { modify, applyEdits } from "jsonc-parser"

export const ModelsCommand = cmd({
  command: "models",
  describe: "list and manage AI models",
  builder: (yargs: Argv) =>
    yargs
      .command(ModelsListCommand)
      .command(ModelsTestCommand)
      .command(ModelsCompareCommand)
      .command(ModelsFavoriteCommand)
      .command(ModelsRefreshCommand)
      .demandCommand(),
  async handler() {},
})

export const ModelsListCommand = cmd({
  command: "list [provider]",
  aliases: ["ls"],
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()

        function printModels(providerID: string, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const provider = providers[args.provider]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          printModels(args.provider, args.verbose)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsHopCoderX = a.startsWith("hopcoderx")
          const bIsHopCoderX = b.startsWith("hopcoderx")
          if (aIsHopCoderX && !bIsHopCoderX) return -1
          if (!aIsHopCoderX && bIsHopCoderX) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          printModels(providerID, args.verbose)
        }
      },
    })
  },
})

export const ModelsTestCommand = cmd({
  command: "test <model>",
  describe: "test a model with a simple prompt",
  builder: (yargs: Argv) =>
    yargs
      .positional("model", {
        describe: "model to test in format provider/model-id",
        type: "string",
        demandOption: true,
      })
      .option("prompt", {
        type: "string",
        describe: "test prompt to send",
        default: "Say hello in one sentence.",
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Model Test")

    const [providerID, modelID] = args.model.split("/")
    if (!providerID || !modelID) {
      prompts.log.error("Invalid model format. Use: provider/model-id")
      prompts.outro("Done")
      return
    }

    const providers = await Provider.list()
    const provider = providers[providerID]
    if (!provider) {
      prompts.log.error(`Provider not found: ${providerID}`)
      prompts.outro("Done")
      return
    }

    const modelInfo = provider.models[modelID]
    if (!modelInfo) {
      prompts.log.error(`Model not found: ${modelID}`)
      prompts.outro(`Available models: ${Object.keys(provider.models).slice(0, 5).join(", ")}...`)
      return
    }

    const spinner = prompts.spinner()
    spinner.start(`Testing ${args.model}`)

    try {
      // Simple test via AI SDK
      const { streamText } = await import("ai")
      const modelConfig = Provider.getModel(providerID, modelID)
      const languageModel = await Provider.getLanguage(await modelConfig)
      const result = await streamText({
        model: languageModel,
        messages: [{ role: "user", content: args.prompt }],
      })

      const response = await result.text
      spinner.stop()

      prompts.log.success("Response:")
      prompts.log.info(response.trim())
      prompts.outro("Test complete")
    } catch (error) {
      spinner.stop()
      prompts.log.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`)
      prompts.outro("Done")
    }
  },
})

export const ModelsCompareCommand = cmd({
  command: "compare <model1> <model2>",
  describe: "compare two models side by side",
  builder: (yargs: Argv) =>
    yargs
      .positional("model1", {
        describe: "first model to compare",
        type: "string",
        demandOption: true,
      })
      .positional("model2", {
        describe: "second model to compare",
        type: "string",
        demandOption: true,
      })
      .option("prompt", {
        type: "string",
        describe: "test prompt",
        default: "Explain recursion in 2 sentences.",
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Model Comparison")

    const spinner = prompts.spinner()
    spinner.start("Testing both models")

    const results: Record<string, string> = {}

    for (const modelArg of [args.model1, args.model2]) {
      try {
        const [providerID, modelID] = modelArg.split("/")
        if (!providerID || !modelID) {
          results[modelArg] = "Error: Invalid model format"
          continue
        }
        const { streamText } = await import("ai")
        const modelConfig = Provider.getModel(providerID, modelID)
        const languageModel = await Provider.getLanguage(await modelConfig)
        const result = await streamText({
          model: languageModel,
          messages: [{ role: "user", content: args.prompt }],
        })
        results[modelArg] = (await result.text).trim()
      } catch (error) {
        results[modelArg] = `Error: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    spinner.stop()

    prompts.log.info(`\nPrompt: ${args.prompt}\n`)

    prompts.log.info(`--- ${args.model1} ---`)
    prompts.log.info(results[args.model1])
    prompts.log.info("")
    prompts.log.info(`--- ${args.model2} ---`)
    prompts.log.info(results[args.model2])

    prompts.outro("Comparison complete")
  },
})

export const ModelsFavoriteCommand = cmd({
  command: "favorite [model]",
  aliases: ["fav"],
  describe: "mark a model as favorite or list favorites",
  builder: (yargs: Argv) =>
    yargs.option("list", {
      type: "boolean",
      describe: "list all favorite models",
      default: false,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Favorite Models")

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

        const favorites = config.favoriteModels || []

        if (args.list || !args.model) {
          if (favorites.length === 0) {
            prompts.log.info("No favorite models set")
            prompts.log.info("Use: hopcoderx models favorite <provider/model-id>")
          } else {
            prompts.log.info("Favorite models:")
            for (const model of favorites) {
              prompts.log.info(`  • ${model}`)
            }
          }
          prompts.outro("Done")
          return
        }

        // Add model to favorites
        if (!favorites.includes(args.model)) {
          favorites.push(args.model)
          config.favoriteModels = favorites

          const edits = modify(configContent, ["favoriteModels"], favorites, {
            formattingOptions: { tabSize: 2, insertSpaces: true },
          })

          if (edits.length > 0) {
            const result = applyEdits(configContent, edits)
            await Filesystem.write(configPath, result)
          }

          prompts.log.success(`Added ${args.model} to favorites`)
        } else {
          prompts.log.info(`${args.model} is already a favorite`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const ModelsRefreshCommand = cmd({
  command: "refresh",
  describe: "refresh the models cache from models.dev",
  async handler() {
    UI.empty()
    prompts.intro("Models Refresh")

    const spinner = prompts.spinner()
    spinner.start("Fetching latest models from models.dev")

    try {
      await ModelsDev.refresh()
      spinner.stop()
      prompts.log.success("Models cache refreshed")
      prompts.outro("Done")
    } catch (error) {
      spinner.stop()
      prompts.log.error(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      prompts.outro("Done")
    }
  },
})
