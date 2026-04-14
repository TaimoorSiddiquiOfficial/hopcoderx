/**
 * Policy Engine for HopCoderX
 *
 * Organization-wide policies for:
 *   - Tool restrictions
 *   - Model restrictions
 *   - Compliance requirements
 *   - Security policies
 *
 * Policy format (YAML):
 * ```yaml
 * version: 1
 * name: "Default Policy"
 * rules:
 *   - id: no-secrets
 *     description: "Block tools that access secrets"
 *     tools: ["secrets"]
 *     action: deny
 *   - id: approved-models
 *     description: "Only use approved AI models"
 *     models: ["anthropic/*", "openai/gpt-*"]
 *     action: allow
 * ```
 */

import z from "zod"
import { promises as fs } from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import yaml from "yaml"

const log = Log.create({ service: "policy" })

// ─── Types ────────────────────────────────────────────────────────────────────

export const PolicyRule = z.object({
  id: z.string(),
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  action: z.enum(["allow", "deny", "ask"]),
  conditions: z.record(z.string(), z.any()).optional(),
  message: z.string().optional(),
})

export type PolicyRule = z.infer<typeof PolicyRule>

export const Policy = z.object({
  version: z.number().default(1),
  name: z.string(),
  description: z.string().optional(),
  enforced: z.boolean().default(true),
  rules: z.array(PolicyRule),
  metadata: z.object({
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    createdBy: z.string().optional(),
  }).optional(),
})

export type Policy = z.infer<typeof Policy>

export interface PolicyEvaluation {
  allowed: boolean
  rule?: PolicyRule
  reason?: string
}

// ─── Policy Engine ────────────────────────────────────────────────────────────

const POLICY_FILE = () => path.join(Global.Path.config, "policy.yaml")
const POLICY_CACHE_FILE = () => path.join(Global.Path.data, "policy-cache.json")

export class PolicyEngine {
  private policy: Policy | null = null
  private loadedAt: number = 0

  /**
   * Load policy from file
   */
  async load(): Promise<Policy | null> {
    try {
      const content = await fs.readFile(POLICY_FILE(), "utf8")
      const parsed = yaml.parse(content)
      this.policy = Policy.parse(parsed)
      this.loadedAt = Date.now()

      log.info("policy loaded", { name: this.policy.name, rules: this.policy.rules.length })

      return this.policy
    } catch (e) {
      log.warn("policy load failed", { error: e instanceof Error ? e.message : String(e) })
      this.policy = null
      return null
    }
  }

  /**
   * Save policy to file
   */
  async save(policy: Policy): Promise<void> {
    policy.metadata = {
      ...policy.metadata,
      updatedAt: Date.now(),
    }

    await fs.mkdir(Global.Path.config, { recursive: true })
    await fs.writeFile(POLICY_FILE(), yaml.stringify(policy))

    this.policy = policy
    this.loadedAt = Date.now()

    log.info("policy saved", { name: policy.name })
  }

  /**
   * Create default policy
   */
  async createDefault(): Promise<Policy> {
    const policy: Policy = {
      version: 1,
      name: "Default Policy",
      description: "Default security and compliance policies",
      enforced: true,
      rules: [
        {
          id: "no-secrets-access",
          description: "Block direct secrets tool access",
          tools: ["secrets"],
          action: "deny",
          message: "Secrets access is restricted by policy",
        },
        {
          id: "approved-models-only",
          description: "Only use approved AI models",
          models: ["anthropic/*", "openai/gpt-*", "google/gemini-*"],
          action: "allow",
        },
        {
          id: "no-external-network",
          description: "Block external network access",
          tools: ["webfetch", "websearch"],
          action: "ask",
          message: "Network access requires approval",
        },
      ],
      metadata: {
        createdAt: Date.now(),
        createdBy: "system",
      },
    }

    await this.save(policy)
    return policy
  }

  /**
   * Get current policy
   */
  getPolicy(): Policy | null {
    // Reload if older than 5 minutes
    if (this.policy && Date.now() - this.loadedAt > 5 * 60 * 1000) {
      this.load()
    }
    return this.policy
  }

  /**
   * Check if tool is allowed
   */
  checkTool(toolName: string, context?: Record<string, unknown>): PolicyEvaluation {
    const policy = this.getPolicy()

    if (!policy || !policy.enforced) {
      return { allowed: true }
    }

    for (const rule of policy.rules) {
      if (rule.tools) {
        for (const pattern of rule.tools) {
          if (this.matchesPattern(toolName, pattern)) {
            return {
              allowed: rule.action === "allow",
              rule,
              reason: rule.message || `${rule.action}: ${rule.description}`,
            }
          }
        }
      }
    }

    // Default: allow if no matching rule
    return { allowed: true }
  }

  /**
   * Check if model is allowed
   */
  checkModel(modelId: string): PolicyEvaluation {
    const policy = this.getPolicy()

    if (!policy || !policy.enforced) {
      return { allowed: true }
    }

    for (const rule of policy.rules) {
      if (rule.models) {
        for (const pattern of rule.models) {
          if (this.matchesPattern(modelId, pattern)) {
            return {
              allowed: rule.action === "allow",
              rule,
              reason: rule.message || `${rule.action}: ${rule.description}`,
            }
          }
        }
      }
    }

    // Default: deny if models are specified but no match
    if (policy.rules.some((r) => r.models && r.action === "allow")) {
      return {
        allowed: false,
        reason: "Model not in approved list",
      }
    }

    return { allowed: true }
  }

  /**
   * Check if command is allowed
   */
  checkCommand(command: string): PolicyEvaluation {
    const policy = this.getPolicy()

    if (!policy || !policy.enforced) {
      return { allowed: true }
    }

    for (const rule of policy.rules) {
      if (rule.commands) {
        for (const pattern of rule.commands) {
          if (this.matchesPattern(command, pattern)) {
            return {
              allowed: rule.action === "allow",
              rule,
              reason: rule.message || `${rule.action}: ${rule.description}`,
            }
          }
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Evaluate multiple items at once
   */
  evaluate(items: Array<{ type: "tool" | "model" | "command"; value: string }>): {
    allowed: boolean
    denied: Array<{ type: string; value: string; reason: string }>
  } {
    const denied: Array<{ type: string; value: string; reason: string }> = []

    for (const item of items) {
      let result: PolicyEvaluation

      switch (item.type) {
        case "tool":
          result = this.checkTool(item.value)
          break
        case "model":
          result = this.checkModel(item.value)
          break
        case "command":
          result = this.checkCommand(item.value)
          break
        default:
          result = { allowed: true }
      }

      if (!result.allowed) {
        denied.push({
          type: item.type,
          value: item.value,
          reason: result.reason || "Denied by policy",
        })
      }
    }

    return {
      allowed: denied.length === 0,
      denied,
    }
  }

  /**
   * Get policy summary for display
   */
  getSummary(): {
    name: string
    enforced: boolean
    ruleCount: number
    rules: Array<{ id: string; description?: string; action: string }>
  } | null {
    const policy = this.getPolicy()
    if (!policy) return null

    return {
      name: policy.name,
      enforced: policy.enforced,
      ruleCount: policy.rules.length,
      rules: policy.rules.map((r) => ({
        id: r.id,
        description: r.description,
        action: r.action,
      })),
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private matchesPattern(value: string, pattern: string): boolean {
    // Convert glob-like patterns to regex
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")

    const regex = new RegExp(`^${regexPattern}$`, "i")
    return regex.test(value)
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const policyEngine = new PolicyEngine()

// ─── CLI Command ──────────────────────────────────────────────────────────────

import { cmd } from "../cli/cmd/cmd"
import { UI } from "../cli/ui"
import * as prompts from "@clack/prompts"
import type { Argv } from "yargs"

export const PolicyCommand = cmd({
  command: "policy [action]",
  describe: "Manage organization policies",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        choices: ["show", "create", "edit", "validate", "check"] as const,
        describe: "Action to perform",
      })
      .option("tool", { type: "string", describe: "Check if tool is allowed" })
      .option("model", { type: "string", describe: "Check if model is allowed" })
      .option("command", { type: "string", describe: "Check if command is allowed" }),
  async handler(args) {
    UI.empty()
    prompts.intro("Policy Engine")

    const action = args.action as string | undefined

    // Quick check mode
    if (args.tool) {
      const result = policyEngine.checkTool(args.tool as string)
      if (result.allowed) {
        prompts.log.success(`Tool '${args.tool}' is allowed`)
      } else {
        prompts.log.error(`Tool '${args.tool}' denied: ${result.reason}`)
      }
      return
    }

    if (args.model) {
      const result = policyEngine.checkModel(args.model as string)
      if (result.allowed) {
        prompts.log.success(`Model '${args.model}' is allowed`)
      } else {
        prompts.log.error(`Model '${args.model}' denied: ${result.reason}`)
      }
      return
    }

    if (args.command) {
      const result = policyEngine.checkCommand(args.command as string)
      if (result.allowed) {
        prompts.log.success(`Command '${args.command}' is allowed`)
      } else {
        prompts.log.error(`Command '${args.command}' denied: ${result.reason}`)
      }
      return
    }

    // Action handlers
    switch (action) {
      case "show": {
        const summary = policyEngine.getSummary()
        if (!summary) {
          prompts.log.warn("No policy configured")
          prompts.log.info("Create one with: hopcoderx policy create")
          return
        }

        prompts.log.info(`Policy: ${summary.name}`)
        prompts.log.info(`Enforced: ${summary.enforced ? "Yes" : "No"}`)
        prompts.log.info(`Rules: ${summary.ruleCount}`)
        prompts.log.info("")

        for (const rule of summary.rules) {
          const icon = rule.action === "allow" ? "✓" : rule.action === "deny" ? "✗" : "?"
          prompts.log.info(`  ${icon} ${rule.id}: ${rule.description || "No description"}`)
        }
        break
      }

      case "create": {
        await policyEngine.createDefault()
        prompts.log.success("Default policy created")
        prompts.log.info(`Edit at: ${POLICY_FILE()}`)
        break
      }

      case "validate": {
        await policyEngine.load()
        const policy = policyEngine.getPolicy()

        if (!policy) {
          prompts.log.error("No policy found or invalid format")
          return
        }

        prompts.log.success("Policy is valid")
        prompts.log.info(`Name: ${policy.name}`)
        prompts.log.info(`Rules: ${policy.rules.length}`)
        break
      }

      case "edit": {
        prompts.log.info(`Edit policy file: ${POLICY_FILE()}`)
        break
      }

      default: {
        prompts.log.info("Usage: hopcoderx policy <show|create|edit|validate|check>")
      }
    }

    prompts.outro("Done")
  },
})
