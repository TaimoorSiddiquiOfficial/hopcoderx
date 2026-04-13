import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { MCP } from "../../mcp"

export const WhoamiCommand = cmd({
  command: "whoami",
  describe: "show current authentication and configuration status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Who Am I")

        const config = await Config.get()
        const auth = await Auth.all()

        // Display active model
        const activeModel = config.model
        if (activeModel) {
          prompts.log.info(`Model: ${UI.Style.TEXT_STRONG}${activeModel}${UI.Style.TEXT_NORMAL}`)
        } else {
          prompts.log.warn("No default model configured")
        }

        // Display configured providers
        const providers = Object.entries(auth)
        if (providers.length > 0) {
          prompts.log.info(`\nAuthenticated Providers (${providers.length}):`)
          for (const [provider, entry] of providers) {
            const icon = entry.type === "oauth" ? "🔑" : "🔐"
            const typeLabel = entry.type === "oauth" ? "OAuth" : "API Key"
            prompts.log.info(`  ${icon} ${provider} (${typeLabel})`)

            if (entry.type === "oauth" && entry.expires) {
              const expiresDate = new Date(entry.expires * 1000)
              const isExpired = entry.expires < Date.now() / 1000
              prompts.log.info(`     Expires: ${expiresDate.toISOString()} ${isExpired ? UI.Style.TEXT_DANGER + "(EXPIRED)" + UI.Style.TEXT_NORMAL : ""}`)
            }
          }
        } else {
          prompts.log.warn("\nNo providers authenticated")
          prompts.log.info("Run 'hopcoderx auth' to configure a provider")
        }

        // Display active MCP servers
        const mcpSummary = await MCP.status()
        const connectedServers = Object.entries(mcpSummary).filter(
          ([_, status]) => status.status === "connected"
        )

        if (connectedServers.length > 0) {
          prompts.log.info(`\nActive MCP Servers (${connectedServers.length}):`)
          for (const [name, status] of connectedServers) {
            prompts.log.info(`  ✓ ${name}`)
          }
        }

        // Display configured agents
        const agents = config.agent ?? {}
        const agentCount = Object.keys(agents).length
        if (agentCount > 0) {
          prompts.log.info(`\nConfigured Agents (${agentCount}):`)
          const primaryAgents = Object.entries(agents).filter(([_, a]: [string, any]) => a.mode === "primary")
          for (const [name, agent] of primaryAgents) {
            prompts.log.info(`  → ${name}${agent.description ? `: ${agent.description}` : ""}`)
          }
        }

        // Display instructions
        const instructions = config.instructions ?? []
        if (instructions.length > 0) {
          prompts.log.info(`\nInstructions (${instructions.length}):`)
          for (const instr of instructions.slice(0, 5)) {
            prompts.log.info(`  - ${instr}`)
          }
          if (instructions.length > 5) {
            prompts.log.info(`  ... and ${instructions.length - 5} more`)
          }
        }

        prompts.outro("Done")
      },
    })
  },
})
