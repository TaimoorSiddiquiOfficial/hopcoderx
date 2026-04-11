import { Auth } from "../auth"
import { Config } from "../config/config"
import { Global } from "../global"
import { Installation } from "../installation"
import { Provider } from "../provider/provider"
import { ModelsDev } from "../provider/models"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { MCP } from "../mcp"
import { McpBuiltins } from "../mcp/builtins"
import path from "path"

export type InstallationSummary = {
  version: string
  dev: boolean
  method: Installation.DisplayMethod
  launcherPath: string
  shimConflicts: Installation.ShimConflict[]
  logFile?: string
  logExists: boolean
  directories: Array<{
    label: "Data dir" | "Config dir" | "Cache dir"
    path: string
    exists: boolean
  }>
}

export async function getInstallationSummary(): Promise<InstallationSummary> {
  const launcherPath = Installation.launcherPath()
  const method = await Installation.displayMethod()
  const shimConflicts = Installation.shimConflicts()
  const logFile = Log.file()
  const logExists = logFile ? await Filesystem.exists(logFile) : false
  const directories = await Promise.all(
    ([
      ["Data dir", Global.Path.data],
      ["Config dir", Global.Path.config],
      ["Cache dir", Global.Path.cache],
    ] as const).map(async ([label, dir]) => ({
      label,
      path: dir,
      exists: await Filesystem.exists(dir),
    })),
  )

  return {
    version: Installation.VERSION,
    dev: Installation.isLocal(),
    method,
    launcherPath,
    shimConflicts,
    logFile,
    logExists,
    directories,
  }
}

export type ProviderSummary = {
  registryLoaded: boolean
  registryCount: number
  configuredProviderNames: string[]
  missingProviderNames: string[]
  providerList: Array<{
    id: string
    source: string
    models: number
  }>
  activeModel?: string
  failover: string[]
}

export type AuthSummary = {
  count: number
  entries: Array<{
    provider: string
    type: "OAuth" | "API key"
  }>
}

export type ConfigSummary = {
  globalConfigPath: string
  globalExists: boolean
  projectConfigPath: string
  projectExists: boolean
  plugins: string[]
  instructionsCount: number
}

export type McpSummary = {
  count: number
  configuredCount: number
  builtinCount: number
  connectedCount: number
  needsAuthCount: number
  failedCount: number
  servers: Array<{
    name: string
    type: string
    valid: boolean
    configured: boolean
    builtin: boolean
    launchMode?: string
    detail?: string
    status: MCP.Status["status"]
    connected: boolean
    auth?: MCP.AuthStatus
    error?: string
  }>
}

export type DaemonSummary = {
  pidFile: string
  running: boolean
}

export type LspSummary = {
  count: number
}

export type RuntimeSummary = {
  provider: ProviderSummary
  auth: AuthSummary
  config: ConfigSummary
  mcp: McpSummary
  daemon: DaemonSummary
  lsp: LspSummary
}

type McpEntry = NonNullable<Config.Info["mcp"]>[string]

function isMcpConfigured(entry: McpEntry | undefined): entry is Config.Mcp {
  return typeof entry === "object" && entry !== null && "type" in entry
}

function getMcpDetail(entry: McpEntry | undefined, builtin?: McpBuiltins.BuiltinEntry) {
  const resolved = isMcpConfigured(entry) ? entry : builtin?.config
  if (!resolved) return undefined
  return resolved.type === "remote" ? resolved.url : resolved.command.join(" ")
}

function supportsMcpOAuth(entry: Config.Mcp | undefined) {
  return !!entry && entry.type === "remote" && entry.oauth !== false
}

export function summarizeMcpServers(input: {
  configMcp?: NonNullable<Config.Info["mcp"]>
  statuses?: Record<string, MCP.Status>
  authByServer?: Record<string, MCP.AuthStatus | undefined>
}): McpSummary {
  const configMcp = input.configMcp ?? {}
  const statuses = input.statuses ?? {}
  const authByServer = input.authByServer ?? {}
  const serverNames = new Set([...Object.keys(configMcp), ...Object.keys(statuses)])

  const servers = [...serverNames]
    .map((name) => {
      const entry = configMcp[name]
      const builtin = McpBuiltins.getById(name)
      const runtimeStatus = statuses[name]
      const valid = isMcpConfigured(entry) || !!builtin
      const status = runtimeStatus?.status ?? ("disabled" as const)

      return {
        name,
        type: isMcpConfigured(entry) ? entry.type : builtin?.config.type ?? "?",
        valid,
        configured: entry !== undefined,
        builtin: !!builtin,
        launchMode: builtin?.launchMode,
        detail: getMcpDetail(entry, builtin),
        status,
        connected: status === "connected",
        auth: authByServer[name],
        error: runtimeStatus && "error" in runtimeStatus ? runtimeStatus.error : undefined,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    count: servers.length,
    configuredCount: servers.filter((server) => server.configured).length,
    builtinCount: servers.filter((server) => server.builtin).length,
    connectedCount: servers.filter((server) => server.connected).length,
    needsAuthCount: servers.filter(
      (server) => server.status === "needs_auth" || server.status === "needs_client_registration",
    ).length,
    failedCount: servers.filter((server) => server.status === "failed").length,
    servers,
  }
}

export async function getMcpSummary(config?: Config.Info): Promise<McpSummary> {
  const resolvedConfig = config ?? (await Config.get())
  const statuses = await MCP.status()
  const serverNames = new Set([...Object.keys(resolvedConfig.mcp ?? {}), ...Object.keys(statuses)])
  const authByServer = Object.fromEntries(
    await Promise.all(
      [...serverNames].map(async (name) => {
        const entry = resolvedConfig.mcp?.[name]
        const builtin = McpBuiltins.getById(name)
        const resolved = isMcpConfigured(entry) ? entry : builtin?.config
        return [name, supportsMcpOAuth(resolved) ? await MCP.getAuthStatus(name) : undefined] as const
      }),
    ),
  )

  return summarizeMcpServers({
    configMcp: resolvedConfig.mcp,
    statuses,
    authByServer,
  })
}

export async function getRuntimeSummary(): Promise<RuntimeSummary> {
  const config = await Config.get()
  const authAll = await Auth.all()
  const env = process.env as Record<string, string | undefined>

  let registry: Record<string, ModelsDev.Provider> = {}
  let registryLoaded = true
  try {
    registry = await ModelsDev.get()
  } catch {
    registryLoaded = false
  }

  const providerList = Object.entries(await Provider.list()).map(([id, info]) => ({
    id,
    source: info.source,
    models: Object.keys(info.models).length,
  }))

  const configuredProviderNames: string[] = []
  const missingProviderNames: string[] = []
  for (const [id, provider] of Object.entries(registry)) {
    const hasEnv = provider.env.some((key) => env[key])
    const hasAuth = !!authAll[id]
    const hasConfig = !!config.provider?.[id]?.options?.apiKey
    if (hasEnv || hasAuth || hasConfig) {
      configuredProviderNames.push(provider.name)
    } else if (provider.env.length > 0) {
      missingProviderNames.push(provider.name)
    }
  }

  const authEntries = Object.entries(authAll).map(([provider, info]) => ({
    provider,
    type: (info as any).type === "oauth" ? ("OAuth" as const) : ("API key" as const),
  }))

  const globalConfigPath = path.join(Global.Path.config, "hopcoderx.json")
  const projectConfigPath = path.join(process.cwd(), "hopcoderx.json")

  const daemonPidFile = path.join(Global.Path.state, "daemon.pid")
  const mcp = await getMcpSummary(config)

  return {
    provider: {
      registryLoaded,
      registryCount: Object.keys(registry).length,
      configuredProviderNames,
      missingProviderNames,
      providerList,
      activeModel: config.model,
      failover: ((config as any).provider_failover as string[] | undefined) ?? [],
    },
    auth: {
      count: authEntries.length,
      entries: authEntries,
    },
    config: {
      globalConfigPath,
      globalExists: await Filesystem.exists(globalConfigPath),
      projectConfigPath,
      projectExists: await Filesystem.exists(projectConfigPath),
      plugins: config.plugin ?? [],
      instructionsCount: (config.instructions ?? []).length,
    },
    mcp,
    daemon: {
      pidFile: daemonPidFile,
      running: await Filesystem.exists(daemonPidFile),
    },
    lsp: {
      count: Object.keys(config.lsp ?? {}).length,
    },
  }
}
