import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Global } from "../../global"
import path from "path"
import { Filesystem } from "../../util/filesystem"
import { ModelsDev } from "../../provider/models"
import { pipe, sortBy } from "remeda"
import open from "open"

export const InitCommand = cmd({
  command: "init",
  describe: "initialize a new HopCoderX project with interactive setup",
  async handler() {
    UI.empty()
    prompts.intro("HopCoderX Setup Wizard")

    const configPath = path.join(process.cwd(), "hopcoderx.json")

    // Check if config already exists
    if (await Filesystem.exists(configPath)) {
      const confirm = await prompts.confirm({
        message: "hopcoderx.json already exists. Overwrite?",
        initialValue: false,
      })
      if (prompts.isCancel(confirm)) throw new UI.CancelledError()
      if (!confirm) {
        prompts.log.info("Setup cancelled")
        prompts.outro("Done")
        return
      }
    }

    // Welcome message
    prompts.log.message(
      "This wizard will help you configure HopCoderX for your project.\n" +
      "You can always change these settings later by editing hopcoderx.json"
    )

    // Step 1: Select AI Provider
    const provider = await prompts.select({
      message: "Select your AI provider",
      options: [
        { label: "HopCoderX (Recommended)", value: "hopcoderx", hint: "Best overall experience" },
        { label: "Anthropic", value: "anthropic", hint: "Claude models" },
        { label: "OpenAI", value: "openai", hint: "GPT models" },
        { label: "Google", value: "google", hint: "Gemini models" },
        { label: "GitHub Copilot", value: "github-copilot", hint: "Copilot integration" },
        { label: "OpenRouter", value: "openrouter", hint: "Multiple providers" },
        { label: "Skip for now", value: "skip", hint: "Configure later" },
      ],
    })

    if (prompts.isCancel(provider)) throw new UI.CancelledError()

    const config: any = {
      $schema: "https://hopcoder.dev/config.json",
    }

    if (provider !== "skip") {
      // Step 2: Select Model
      const spinner = prompts.spinner()
      spinner.start("Loading available models")

      try {
        await ModelsDev.refresh()
        const providers = await ModelsDev.get()
        const providerData = providers[provider]

        spinner.stop()

        if (!providerData || Object.keys(providerData.models).length === 0) {
          prompts.log.warn(`No models found for provider: ${provider}`)
          prompts.log.info("You can configure the model manually in hopcoderx.json")
        } else {
          const modelEntries = Object.entries(providerData.models)
          const sortedModels = pipe(
            modelEntries,
            sortBy(([id]) => id)
          )

          const modelOptions = sortedModels.map(([id, model]) => ({
            label: model.name || id,
            value: id,
            hint: model.limit?.context ? `${Math.round(model.limit.context / 1000)}K context` : undefined,
          }))

          // Pre-select recommended model if available
          const recommendedModel = sortedModels.find(([, m]) =>
            m.name?.toLowerCase().includes("sonnet") ||
            m.name?.toLowerCase().includes("claude")
          ) || sortedModels[0]

          const model = await prompts.select({
            message: "Select default model",
            options: modelOptions,
            initialValue: recommendedModel?.[0],
          })

          if (prompts.isCancel(model)) throw new UI.CancelledError()

          config.model = `${provider}/${model}`
        }
      } catch (error) {
        spinner.stop()
        prompts.log.warn("Could not load models from registry")
        prompts.log.info("You can configure the model manually in hopcoderx.json")
      }

      // Step 3: API Key (if needed)
      const needsApiKey = ["anthropic", "openai", "google", "openrouter"].includes(provider)
      if (needsApiKey) {
        const hasApiKey = await prompts.confirm({
          message: `Do you have your ${provider} API key ready?`,
          initialValue: true,
        })

        if (prompts.isCancel(hasApiKey)) throw new UI.CancelledError()

        if (hasApiKey) {
          const apiKey = await prompts.password({
            message: `Enter your ${provider} API key`,
            validate: (value) => {
              if (!value || value.length < 10) {
                return "API key must be at least 10 characters"
              }
              return undefined
            },
          })

          if (prompts.isCancel(apiKey)) throw new UI.CancelledError()

          // Store in environment variable suggestion, not in config
          prompts.log.info(
            `\nSet your API key as an environment variable:` +
            `\n  ${getEnvVarName(provider)}=${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
          )
        } else {
          prompts.log.info(
            `\nYou'll need to set your API key before using HopCoderX.` +
            `\nSet the ${getEnvVarName(provider)} environment variable.`
          )
        }
      }

      // GitHub Copilot special handling
      if (provider === "github-copilot") {
        prompts.log.info(
          `\nGitHub Copilot requires authentication via GitHub.` +
          `\nRun 'hopcoderx auth' to complete the setup.`
        )
      }
    }

    // Step 4: MCP Servers
    const setupMcp = await prompts.confirm({
      message: "Would you like to configure MCP (Model Context Protocol) servers?",
      initialValue: false,
    })

    if (prompts.isCancel(setupMcp)) throw new UI.CancelledError()

    if (setupMcp) {
      const mcpType = await prompts.select({
        message: "Select MCP server type",
        options: [
          { label: "Built-in servers", value: "builtin", hint: "Filesystem, Memory, GitHub, Git" },
          { label: "Remote server", value: "remote", hint: "Connect to a URL" },
          { label: "Skip MCP", value: "skip", hint: "Configure later" },
        ],
      })

      if (prompts.isCancel(mcpType)) throw new UI.CancelledError()

      if (mcpType === "builtin") {
        const builtinServers = await prompts.multiselect({
          message: "Select built-in servers to enable",
          options: [
            { label: "Filesystem", value: "filesystem", hint: "File operations" },
            { label: "Memory", value: "memory", hint: "Persistent memory" },
            { label: "GitHub", value: "github", hint: "GitHub integration" },
            { label: "Git", value: "git", hint: "Git operations" },
          ],
          required: false,
        })

        if (prompts.isCancel(builtinServers)) throw new UI.CancelledError()

        if (builtinServers.length > 0) {
          config.mcp = {}
          for (const server of builtinServers) {
            config.mcp[`builtin:${server}`] = { type: "local", command: [`builtin:${server}`] }
          }
        }
      } else if (mcpType === "remote") {
        const serverName = await prompts.text({
          message: "Enter MCP server name",
          placeholder: "my-server",
          validate: (value) => {
            if (!value || value.length === 0) return "Required"
            return undefined
          },
        })

        if (prompts.isCancel(serverName)) throw new UI.CancelledError()

        const serverUrl = await prompts.text({
          message: "Enter MCP server URL",
          placeholder: "https://example.com/mcp",
          validate: (value) => {
            if (!value) return "Required"
            try {
              new URL(value)
              return undefined
            } catch {
              return "Invalid URL"
            }
          },
        })

        if (prompts.isCancel(serverUrl)) throw new UI.CancelledError()

        config.mcp = {
          [serverName]: {
            type: "remote" as const,
            url: serverUrl,
          },
        }
      }
    }

    // Step 5: Instructions
    const addInstructions = await prompts.confirm({
      message: "Would you like to add custom instructions for the AI?",
      initialValue: false,
    })

    if (prompts.isCancel(addInstructions)) throw new UI.CancelledError()

    if (addInstructions) {
      const instructions = await prompts.text({
        message: "Enter instructions (e.g., 'Always use TypeScript', 'Prefer functional programming')",
        placeholder: "You are a helpful coding assistant...",
      })

      if (!prompts.isCancel(instructions) && instructions.length > 0) {
        config.instructions = [instructions]
      }
    }

    // Write config file
    const writeSpinner = prompts.spinner()
    writeSpinner.start("Creating hopcoderx.json")

    await Filesystem.write(configPath, JSON.stringify(config, null, 2))

    writeSpinner.stop()

    // Success message
    prompts.log.success("HopCoderX initialized successfully!")

    // Summary
    prompts.log.info("\nConfiguration summary:")
    if (config.model) {
      prompts.log.info(`  Model: ${config.model}`)
    }
    if (config.mcp) {
      prompts.log.info(`  MCP Servers: ${Object.keys(config.mcp).length} configured`)
    }
    if (config.instructions) {
      prompts.log.info(`  Instructions: ${config.instructions.length} set`)
    }

    // Next steps
    prompts.log.info("\nNext steps:")
    if (provider !== "skip" && needsApiKey(provider)) {
      prompts.log.info(`  1. Set your API key: export ${getEnvVarName(provider)}=your-key`)
    }
    prompts.log.info(`  2. Start using HopCoderX: hopcoderx run "your task"`)
    prompts.log.info(`  3. Edit config anytime: hopcoderx config edit`)

    // Open config in editor
    const openEditor = await prompts.confirm({
      message: "Open hopcoderx.json in your editor?",
      initialValue: false,
    })

    if (!prompts.isCancel(openEditor) && openEditor) {
      try {
        await open(configPath)
      } catch {
        // Ignore open failure
      }
    }

    prompts.outro("Happy coding!")
  },
})

function getEnvVarName(provider: string): string {
  const names: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  }
  return names[provider] || `${provider.toUpperCase().replace("-", "_")}_API_KEY`
}

function needsApiKey(provider: string): boolean {
  return ["anthropic", "openai", "google", "openrouter"].includes(provider)
}
