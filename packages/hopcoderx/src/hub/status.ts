import { z } from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { McpAuth } from "../mcp/auth"
import { McpRegistry } from "../mcp/registry"
import { HubManifest } from "./manifest"

export namespace HubStatus {
  type McpConfigLike = Config.Mcp | { enabled?: boolean } | undefined

  export const MCPState = z.object({
    id: z.string(),
    name: z.string(),
    manifest: HubManifest.MCP,
    configured: z.boolean(),
    enabled: z.boolean(),
    effectiveEnabled: z.boolean(),
    authConfigured: z.boolean(),
    missingEnvKeys: z.array(z.string()),
    hasTokens: z.boolean(),
    tokenExpired: z.boolean(),
    readiness: HubManifest.Readiness,
    reason: z.string().optional(),
    runtimeStatus: MCP.Status.optional(),
  })
  export type MCPState = z.infer<typeof MCPState>

  function isConfigured(config: McpConfigLike): config is Config.Mcp {
    return Boolean(config && typeof config === "object" && "type" in config)
  }

  function isEnabled(config: McpConfigLike, activation: HubManifest.Activation) {
    if (!config || typeof config !== "object" || !("enabled" in config) || config.enabled === undefined) {
      return activation.defaultEnabled
    }
    return config.enabled !== false
  }

  function missingEnvKeys(auth: HubManifest.Auth, env: Record<string, string | undefined>) {
    return auth.envKeys.filter((key) => !env[key]?.trim())
  }

  function authConfigured(input: {
    auth: HubManifest.Auth
    missingEnvKeys: string[]
    hasTokens: boolean
    tokenExpired: boolean
  }) {
    if (!input.auth.required) return true
    if (input.auth.mode === "oauth") {
      return input.hasTokens && !input.tokenExpired
    }
    return input.missingEnvKeys.length === 0
  }

  function readiness(input: {
    configured: boolean
    enabled: boolean
    effectiveEnabled: boolean
    auth: HubManifest.Auth
    authConfigured: boolean
    tokenExpired: boolean
    runtime?: MCP.Status
    missingEnvKeys: string[]
    activation: HubManifest.Activation
  }): { readiness: HubManifest.Readiness; reason?: string } {
    const runtime = input.runtime
    if (runtime?.status === "connected") {
      return { readiness: "connected" }
    }

    if (runtime?.status === "failed") {
      return { readiness: "error", reason: runtime.error }
    }

    if (runtime?.status === "needs_auth" || runtime?.status === "needs_client_registration") {
      return {
        readiness: input.tokenExpired ? "auth-expired" : "auth-required",
        reason: "The MCP server needs authentication before it can connect.",
      }
    }

    if (!input.authConfigured) {
      if (input.tokenExpired) {
        return {
          readiness: "auth-expired",
          reason: "Stored credentials expired and the server must be re-authenticated.",
        }
      }
      return {
        readiness: input.effectiveEnabled ? "auth-required" : "disabled-missing-auth",
        reason:
          input.missingEnvKeys.length > 0
            ? `Missing required environment: ${input.missingEnvKeys.join(", ")}`
            : "Authentication is required before enabling this MCP server.",
      }
    }

    if (!input.configured) {
      return {
        readiness: "disabled-missing-config",
        reason: input.activation.requiresSetup ? "This MCP server still needs setup before it can run." : undefined,
      }
    }

    if (!input.enabled || !input.effectiveEnabled) {
      return {
        readiness: "configured-not-connected",
        reason: "This MCP server is configured but currently disabled.",
      }
    }

    return {
      readiness: "configured-not-connected",
      reason: "This MCP server is configured and can be connected on demand.",
    }
  }

  export function resolveMcp(
    entry: McpRegistry.RegistryEntry,
    input: {
      config?: McpConfigLike
      runtime?: MCP.Status
      authEntry?: McpAuth.Entry
      tokenExpired?: boolean | null
      env?: Record<string, string | undefined>
    } = {},
  ): MCPState {
    const manifest = McpRegistry.toManifest(entry)
    const auth = McpRegistry.getAuth(entry)
    const activation = McpRegistry.getActivation(entry)
    const env = input.env ?? process.env
    const missing = missingEnvKeys(auth, env)
    const hasTokens = Boolean(input.authEntry?.tokens?.accessToken)
    const tokenExpired = input.tokenExpired === true
    const configured = isConfigured(input.config)
    const enabled = isEnabled(input.config, activation)
    const isAuthConfigured = authConfigured({
      auth,
      missingEnvKeys: missing,
      hasTokens,
      tokenExpired,
    })
    const effectiveEnabled = enabled && !(activation.autoDisableWhenMissing && !isAuthConfigured)
    const status = readiness({
      configured,
      enabled,
      effectiveEnabled,
      auth,
      authConfigured: isAuthConfigured,
      tokenExpired,
      runtime: input.runtime,
      missingEnvKeys: missing,
      activation,
    })

    return {
      id: manifest.id,
      name: entry.name,
      manifest,
      configured,
      enabled,
      effectiveEnabled,
      authConfigured: isAuthConfigured,
      missingEnvKeys: missing,
      hasTokens,
      tokenExpired,
      readiness: status.readiness,
      reason: status.reason,
      runtimeStatus: input.runtime,
    }
  }

  export async function resolveCurrentMcp(
    entry: McpRegistry.RegistryEntry,
    input: {
      config?: McpConfigLike
      runtime?: MCP.Status
      env?: Record<string, string | undefined>
    } = {},
  ) {
    const authEntry = await McpAuth.get(entry.name)
    const tokenExpired = await McpAuth.isTokenExpired(entry.name)
    return resolveMcp(entry, {
      ...input,
      authEntry,
      tokenExpired,
    })
  }

  export async function resolveAllMcp(input: {
    configMcp?: NonNullable<Config.Info["mcp"]>
    runtime?: Record<string, MCP.Status>
    env?: Record<string, string | undefined>
  } = {}) {
    const authEntries = await McpAuth.all()
    return Promise.all(
      McpRegistry.registry.map(async (entry) => {
        const authEntry = authEntries[entry.name]
        const tokenExpired = await McpAuth.isTokenExpired(entry.name)
        return resolveMcp(entry, {
          config: input.configMcp?.[entry.name],
          runtime: input.runtime?.[entry.name],
          authEntry,
          tokenExpired,
          env: input.env,
        })
      }),
    )
  }
}
