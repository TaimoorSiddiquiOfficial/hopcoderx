/**
 * hopcoderx onboard — guided first-run setup wizard.
 *
 * Steps:
 *   1. Select primary LLM provider + enter API key
 *   2. Configure optional failover providers
 *   3. Set project workspace (auto-detect from cwd)
 *   4. Enable optional daemon (background service)
 *   5. Enable shell completion
 *   6. Summary + next steps
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { ModelsDev } from "../../provider/models"
import { Filesystem } from "../../util/filesystem"
import { modify, applyEdits } from "jsonc-parser"
import path from "path"
import os from "os"
import { execSync } from "child_process"

const POPULAR_PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI (GPT)", envKey: "OPENAI_API_KEY", url: "https://platform.openai.com/api-keys" },
  { id: "google", name: "Google (Gemini)", envKey: "GOOGLE_GENERATIVE_AI_API_KEY", url: "https://aistudio.google.com/apikey" },
  { id: "groq", name: "Groq (fast inference)", envKey: "GROQ_API_KEY", url: "https://console.groq.com/keys" },
  { id: "deepseek", name: "DeepSeek (reasoning)", envKey: "DEEPSEEK_API_KEY", url: "https://platform.deepseek.com/api_keys" },
  { id: "openrouter", name: "OpenRouter (all models)", envKey: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys" },
  { id: "ollama", name: "Ollama (local — no key needed)", envKey: "", url: "https://ollama.com" },
  { id: "lmstudio", name: "LM Studio (local — no key needed)", envKey: "", url: "https://lmstudio.ai" },
]

async function writeGlobalConfig(patch: Record<string, unknown>) {
  const configPath = path.join(Global.Path.config, "hopcoderx.json")
  let existing = "{}"
  try {
    existing = await Filesystem.readText(configPath)
  } catch {
    // file doesn't exist yet
  }

  let result = existing
  for (const [key, value] of Object.entries(patch)) {
    const edits = modify(result, [key], value, {})
    result = applyEdits(result, edits)
  }
  await Filesystem.write(configPath, result)
  return configPath
}

export const OnboardCommand = cmd({
  command: "onboard",
  describe: "guided first-run setup wizard",
  builder: (yargs: Argv) =>
    yargs.option("reset", {
      describe: "re-run onboarding even if already configured",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    prompts.intro("\x1b[1mWelcome to HopCoderX\x1b[0m — let's get you set up in under 2 minutes")

    // Step 1: Check if already configured
    const config = await Config.get()
    const authAll = await Auth.all()
    const env = process.env as Record<string, string | undefined>
    const alreadyConfigured = Object.keys(authAll).length > 0 || POPULAR_PROVIDERS.some((p) => p.envKey && env[p.envKey])

    if (alreadyConfigured && !args.reset) {
      prompts.note(
        "It looks like you already have a provider configured.\nRun with --reset to start fresh, or run `hopcoderx doctor` to check your setup.",
        "Already configured",
      )
      prompts.outro("Nothing to do! Run `hopcoderx` to start coding.")
      return
    }

    // Step 2: Choose primary provider
    const providerChoice = await prompts.select({
      message: "Which LLM provider would you like to use?",
      options: POPULAR_PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
      initialValue: "anthropic",
    })

    if (prompts.isCancel(providerChoice)) {
      prompts.cancel("Onboarding cancelled.")
      return
    }

    const provider = POPULAR_PROVIDERS.find((p) => p.id === providerChoice)!

    // Step 3: API Key (skip for local providers)
    if (provider.envKey) {
      const existingKey = env[provider.envKey]
      if (!existingKey) {
        prompts.note(
          `Get your API key at: \x1b[36m${provider.url}\x1b[0m\nYou can also set the \x1b[1m${provider.envKey}\x1b[0m environment variable instead.`,
          "Get API key",
        )

        const apiKey = await prompts.password({
          message: `Enter your ${provider.name} API key (or leave empty to skip):`,
          validate: (v) => {
            if (!v) return undefined // allow empty
            if (v.length < 10) return "API key seems too short"
            return undefined
          },
        })

        if (!prompts.isCancel(apiKey) && apiKey) {
          await Auth.set(provider.id, { type: "api", key: apiKey })
          prompts.log.success(`API key saved for ${provider.name}`)
        }
      } else {
        prompts.log.info(`Found existing ${provider.envKey} in environment — using it`)
      }
    } else {
      prompts.log.info(`${provider.name} runs locally — no API key needed`)
    }

    // Step 4: Default model selection
    let defaultModel: string | undefined
    try {
      const modelsDev = await ModelsDev.get()
      const providerData = modelsDev[provider.id]
      if (providerData) {
        const modelIds = Object.keys(providerData.models)
        // Pick a sensible default — prefer "latest" or the first model
        const recommended = modelIds.find((id) => id.includes("claude-sonnet") || id.includes("gpt-5") || id.includes("gemini-2.5-pro") || id.includes("deepseek-chat"))
        if (recommended) {
          const useRecommended = await prompts.confirm({
            message: `Use \x1b[1m${provider.id}/${recommended}\x1b[0m as your default model?`,
            initialValue: true,
          })
          if (!prompts.isCancel(useRecommended) && useRecommended) {
            defaultModel = `${provider.id}/${recommended}`
          }
        }
      }
    } catch {
      // models.dev not available — skip model selection
    }

    // Step 5: Failover providers (optional)
    const wantFailover = await prompts.confirm({
      message: "Configure provider failover? (auto-switch when a provider is rate-limited)",
      initialValue: false,
    })

    let failoverChain: string[] = []
    if (!prompts.isCancel(wantFailover) && wantFailover) {
      const failoverChoices = await prompts.multiselect({
        message: "Select fallback providers (in priority order):",
        options: POPULAR_PROVIDERS.filter((p) => p.id !== provider.id && p.envKey !== "").map((p) => ({
          value: p.id,
          label: p.name,
        })),
        required: false,
      })
      if (!prompts.isCancel(failoverChoices)) {
        failoverChain = failoverChoices as string[]
      }
    }

    // Step 6: Shell completion
    let completionSetup = false
    const shell = os.platform() === "win32" ? "pwsh" : (env.SHELL?.split("/").pop() ?? "bash")
    const wantCompletion = await prompts.confirm({
      message: `Set up tab completion for ${shell}?`,
      initialValue: true,
    })

    if (!prompts.isCancel(wantCompletion) && wantCompletion) {
      try {
        if (os.platform() !== "win32") {
          const rcFile = shell === "zsh" ? path.join(os.homedir(), ".zshrc") : path.join(os.homedir(), ".bashrc")
          const completionLine = '\n# HopCoderX tab completion\nsource <(hopcoderx completion)\n'
          const existing = await Filesystem.readText(rcFile).catch(() => "")
          if (!existing.includes("hopcoderx completion")) {
            await Filesystem.write(rcFile, existing + completionLine)
            completionSetup = true
          } else {
            completionSetup = true // already set up
          }
        }
      } catch {
        prompts.log.warn("Could not set up shell completion automatically — run `hopcoderx completion` manually")
      }
    }

    // Step 7: Write config
    const configPatch: Record<string, unknown> = {}
    if (defaultModel) configPatch.model = defaultModel
    if (failoverChain.length > 0) configPatch.provider_failover = [provider.id, ...failoverChain]

    const configPath = await writeGlobalConfig(configPatch)

    // Summary
    const summaryLines = [
      `Provider:  ${provider.name}`,
      defaultModel ? `Model:     ${defaultModel}` : "Model:     (auto-detected)",
      failoverChain.length > 0 ? `Failover:  ${[provider.id, ...failoverChain].join(" → ")}` : "Failover:  disabled",
      `Config:    ${configPath}`,
      completionSetup ? `Completion: set up for ${shell}` : "Completion: skipped",
    ]

    prompts.note(summaryLines.join("\n"), "Setup complete")

    prompts.outro(
      [
        "\x1b[1mYou're ready to go!\x1b[0m",
        "",
        "Quick start:",
        "  hopcoderx                  — open interactive TUI",
        "  hopcoderx run 'task'       — run a task",
        "  hopcoderx doctor           — check system health",
        "  hopcoderx models           — list available models",
        "  hopcoderx auth             — manage API keys",
        "",
        "Docs: \x1b[36mhttps://hopcoder.dev/docs\x1b[0m",
      ].join("\n"),
    )
  },
})
