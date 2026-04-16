import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { McpOAuthProvider } from "../../mcp/oauth-provider"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Installation } from "../../installation"
import path from "path"
import { Global } from "../../global"
import { modify, applyEdits } from "jsonc-parser"
import { Filesystem } from "../../util/filesystem"
import { Bus } from "../../bus"
import { McpRegistry } from "../../mcp/registry"
import { McpBuiltins } from "../../mcp/builtins"
import { getMcpSummary } from "../diagnostics"
import { buildDisabledMcpEntry, buildEnabledMcpEntry, resolveMcpConfigPath, updateMcpConfigEntry } from "../../mcp/config-file"
import { findMissingMcpEnvVars } from "../../mcp/runtime-config"
import { McpInspectCommand } from "./mcp-inspector"

function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "✗"
  }
}

function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

type McpEntry = NonNullable<Config.Info["mcp"]>[string]

type McpConfigured = Config.Mcp
function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

type McpRemote = Extract<McpConfigured, { type: "remote" }>
function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
      .command(McpRegistryCommand)
      .command(McpInstallCommand)
      .command(McpRemoveCommand)
      .command(McpSetupCommand)
      .command(McpConfigureCommand)
      .command(McpBuiltinsCommand)
      .command(McpTestCommand)
      .command(McpReloadCommand)
      .command(McpInspectCommand)
      .demandCommand(),
  async handler() {},
})

export const McpListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Servers")

        const summary = await getMcpSummary()
        const servers = summary.servers

        if (servers.length === 0) {
          prompts.log.warn("No MCP servers configured or active")
          prompts.outro("Add servers with: HopCoderX mcp add, HopCoderX mcp install, or HopCoderX mcp builtins")
          return
        }

        for (const server of servers) {
          let statusIcon: string
          let statusText: string
          let hint = ""

          if (server.status === "connected") {
            statusIcon = "✓"
            statusText = "connected"
            if (server.auth === "authenticated") hint = " (OAuth)"
          } else if (server.status === "disabled") {
            statusIcon = "○"
            statusText = "disabled"
          } else if (server.status === "needs_auth") {
            statusIcon = "⚠"
            statusText = "needs authentication"
          } else if (server.status === "needs_client_registration") {
            statusIcon = "✗"
            statusText = "needs client registration"
            hint = "\n    " + (server.error ?? "Client registration required")
          } else {
            statusIcon = "✗"
            statusText = "failed"
            hint = server.error ? "\n    " + server.error : ""
            if (server.hint) hint += "\n    Hint: " + server.hint
          }

          const labels = [server.type]
          if (server.builtin) labels.push(server.launchMode ? `builtin/${server.launchMode}` : "builtin")
          const typeHint = server.detail ?? labels.join(", ")
          prompts.log.info(
            `${statusIcon} ${server.name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(`${servers.length} server(s)`)
      },
    })
  },
})

export const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .command(McpAuthListCommand),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Authentication")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-capable servers (remote servers with oauth not explicitly disabled)
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.log.info("Remote MCP servers support OAuth by default. Add a remote server in hopcoderx.json:")
          prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`)
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          // Build options with auth status
          const options = await Promise.all(
            oauthServers.map(async ([name, cfg]) => {
              const authStatus = await MCP.getAuthStatus(name)
              const icon = getAuthStatusIcon(authStatus)
              const statusText = getAuthStatusText(authStatus)
              const url = cfg.url
              return {
                label: `${icon} ${name} (${statusText})`,
                value: name,
                hint: url,
              }
            }),
          )

          const selected = await prompts.select({
            message: "Select MCP server to authenticate",
            options,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        if (!isMcpRemote(serverConfig) || serverConfig.oauth === false) {
          prompts.log.error(`MCP server ${serverName} is not an OAuth-capable remote server`)
          prompts.outro("Done")
          return
        }

        // Check if already authenticated
        const authStatus = await MCP.getAuthStatus(serverName)
        if (authStatus === "authenticated") {
          const confirm = await prompts.confirm({
            message: `${serverName} already has valid credentials. Re-authenticate?`,
          })
          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro("Cancelled")
            return
          }
        } else if (authStatus === "expired") {
          prompts.log.warn(`${serverName} has expired credentials. Re-authenticating...`)
        }

        const spinner = prompts.spinner()
        spinner.start("Starting OAuth flow...")

        // Subscribe to browser open failure events to show URL for manual opening
        const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
          if (evt.properties.mcpName === serverName) {
            spinner.stop("Could not open browser automatically")
            prompts.log.warn("Please open this URL in your browser to authenticate:")
            prompts.log.info(evt.properties.url)
            spinner.start("Waiting for authorization...")
          }
        })

        try {
          const status = await MCP.authenticate(serverName)

          if (status.status === "connected") {
            spinner.stop("Authentication successful!")
          } else if (status.status === "needs_client_registration") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
            prompts.log.info("Add clientId to your MCP server config:")
            prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${serverConfig.url}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
          } else if (status.status === "failed") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
          } else {
            spinner.stop("Unexpected status: " + status.status, 1)
          }
        } catch (error) {
          spinner.stop("Authentication failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        } finally {
          unsubscribe()
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpAuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Status")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-capable servers
        const oauthServers = Object.entries(mcpServers).filter(
          (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
        )

        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-capable MCP servers configured")
          prompts.outro("Done")
          return
        }

        for (const [name, serverConfig] of oauthServers) {
          const authStatus = await MCP.getAuthStatus(name)
          const icon = getAuthStatusIcon(authStatus)
          const statusText = getAuthStatusText(authStatus)
          const url = serverConfig.url

          prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
        }

        prompts.outro(`${oauthServers.length} OAuth-capable server(s)`)
      },
    })
  },
})

export const McpLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Logout")

        const authPath = path.join(Global.Path.data, "mcp-auth.json")
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)

        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: "Select MCP server to logout",
            options: serverNames.map((name) => {
              const entry = credentials[name]
              const hasTokens = !!entry.tokens
              const hasClient = !!entry.clientInfo
              let hint = ""
              if (hasTokens && hasClient) hint = "tokens + client"
              else if (hasTokens) hint = "tokens"
              else if (hasClient) hint = "client registration"
              return {
                label: name,
                value: name,
                hint,
              }
            }),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        if (!credentials[serverName]) {
          prompts.log.error(`No credentials found for: ${serverName}`)
          prompts.outro("Done")
          return
        }

        await MCP.removeAuth(serverName)
        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
        prompts.outro("Done")
      },
    })
  },
})

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add MCP server")

        const project = Instance.project

        // Resolve config paths eagerly for hints
        const [projectConfigPath, globalConfigPath] = await Promise.all([
          resolveMcpConfigPath(Instance.worktree),
          resolveMcpConfigPath(Global.Path.config, { global: true }),
        ])

        // Determine scope
        let configPath = globalConfigPath
        if (project.vcs === "git") {
          const scopeResult = await prompts.select({
            message: "Location",
            options: [
              {
                label: "Current project",
                value: projectConfigPath,
                hint: projectConfigPath,
              },
              {
                label: "Global",
                value: globalConfigPath,
                hint: globalConfigPath,
              },
            ],
          })
          if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
          configPath = scopeResult
        }

        const name = await prompts.text({
          message: "Enter MCP server name",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        const type = await prompts.select({
          message: "Select MCP server type",
          options: [
            {
              label: "Local",
              value: "local",
              hint: "Run a local command",
            },
            {
              label: "Remote",
              value: "remote",
              hint: "Connect to a remote URL",
            },
          ],
        })
        if (prompts.isCancel(type)) throw new UI.CancelledError()

        if (type === "local") {
          const command = await prompts.text({
            message: "Enter command to run",
            placeholder: "e.g., HopCoderX x @modelcontextprotocol/server-filesystem",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(command)) throw new UI.CancelledError()

          const mcpConfig: Config.Mcp = {
            type: "local",
            command: command.split(" "),
          }

          await updateMcpConfigEntry(name, mcpConfig, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
          prompts.outro("MCP server added successfully")
          return
        }

        if (type === "remote") {
          const url = await prompts.text({
            message: "Enter MCP server URL",
            placeholder: "e.g., https://example.com/mcp",
            validate: (x) => {
              if (!x) return "Required"
              if (x.length === 0) return "Required"
              const isValid = URL.canParse(x)
              return isValid ? undefined : "Invalid URL"
            },
          })
          if (prompts.isCancel(url)) throw new UI.CancelledError()

          const useOAuth = await prompts.confirm({
            message: "Does this server require OAuth authentication?",
            initialValue: false,
          })
          if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

          let mcpConfig: Config.Mcp

          if (useOAuth) {
            const hasClientId = await prompts.confirm({
              message: "Do you have a pre-registered client ID?",
              initialValue: false,
            })
            if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

            if (hasClientId) {
              const clientId = await prompts.text({
                message: "Enter client ID",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(clientId)) throw new UI.CancelledError()

              const hasSecret = await prompts.confirm({
                message: "Do you have a client secret?",
                initialValue: false,
              })
              if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()

              let clientSecret: string | undefined
              if (hasSecret) {
                const secret = await prompts.password({
                  message: "Enter client secret",
                })
                if (prompts.isCancel(secret)) throw new UI.CancelledError()
                clientSecret = secret
              }

              mcpConfig = {
                type: "remote",
                url,
                oauth: {
                  clientId,
                  ...(clientSecret && { clientSecret }),
                },
              }
            } else {
              mcpConfig = {
                type: "remote",
                url,
                oauth: {},
              }
            }
          } else {
            mcpConfig = {
              type: "remote",
              url,
            }
          }

          await updateMcpConfigEntry(name, mcpConfig, configPath)
          prompts.log.success(`MCP server "${name}" added to ${configPath}`)
        }

        prompts.outro("MCP server added successfully")
      },
    })
  },
})

export const McpDebugCommand = cmd({
  command: "debug <name>",
  describe: "debug OAuth connection for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Debug")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const serverName = args.name

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        if (!isMcpRemote(serverConfig)) {
          prompts.log.error(`MCP server ${serverName} is not a remote server`)
          prompts.outro("Done")
          return
        }

        if (serverConfig.oauth === false) {
          prompts.log.warn(`MCP server ${serverName} has OAuth explicitly disabled`)
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Server: ${serverName}`)
        prompts.log.info(`URL: ${serverConfig.url}`)

        // Check stored auth status
        const authStatus = await MCP.getAuthStatus(serverName)
        prompts.log.info(`Auth status: ${getAuthStatusIcon(authStatus)} ${getAuthStatusText(authStatus)}`)

        const entry = await McpAuth.get(serverName)
        if (entry?.tokens) {
          prompts.log.info(`  Access token: ${entry.tokens.accessToken.substring(0, 20)}...`)
          if (entry.tokens.expiresAt) {
            const expiresDate = new Date(entry.tokens.expiresAt * 1000)
            const isExpired = entry.tokens.expiresAt < Date.now() / 1000
            prompts.log.info(`  Expires: ${expiresDate.toISOString()} ${isExpired ? "(EXPIRED)" : ""}`)
          }
          if (entry.tokens.refreshToken) {
            prompts.log.info(`  Refresh token: present`)
          }
        }
        if (entry?.clientInfo) {
          prompts.log.info(`  Client ID: ${entry.clientInfo.clientId}`)
          if (entry.clientInfo.clientSecretExpiresAt) {
            const expiresDate = new Date(entry.clientInfo.clientSecretExpiresAt * 1000)
            prompts.log.info(`  Client secret expires: ${expiresDate.toISOString()}`)
          }
        }

        const spinner = prompts.spinner()
        spinner.start("Testing connection...")

        // Test basic HTTP connectivity first
        try {
          const response = await fetch(serverConfig.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "HopCoderX-debug", version: Installation.VERSION },
              },
              id: 1,
            }),
          })

          spinner.stop(`HTTP response: ${response.status} ${response.statusText}`)

          // Check for WWW-Authenticate header
          const wwwAuth = response.headers.get("www-authenticate")
          if (wwwAuth) {
            prompts.log.info(`WWW-Authenticate: ${wwwAuth}`)
          }

          if (response.status === 401) {
            prompts.log.warn("Server returned 401 Unauthorized")

            // Try to discover OAuth metadata
            const oauthConfig = typeof serverConfig.oauth === "object" ? serverConfig.oauth : undefined
            const authProvider = new McpOAuthProvider(
              serverName,
              serverConfig.url,
              {
                clientId: oauthConfig?.clientId,
                clientSecret: oauthConfig?.clientSecret,
                scope: oauthConfig?.scope,
              },
              {
                onRedirect: async () => {},
              },
            )

            prompts.log.info("Testing OAuth flow (without completing authorization)...")

            // Try creating transport with auth provider to trigger discovery
            const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
              authProvider,
            })

            try {
              const client = new Client({
                name: "HopCoderX-debug",
                version: Installation.VERSION,
              })
              await client.connect(transport)
              prompts.log.success("Connection successful (already authenticated)")
              await client.close()
            } catch (error) {
              if (error instanceof UnauthorizedError) {
                prompts.log.info(`OAuth flow triggered: ${error.message}`)

                // Check if dynamic registration would be attempted
                const clientInfo = await authProvider.clientInformation()
                if (clientInfo) {
                  prompts.log.info(`Client ID available: ${clientInfo.client_id}`)
                } else {
                  prompts.log.info("No client ID - dynamic registration will be attempted")
                }
              } else {
                prompts.log.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`)
              }
            }
          } else if (response.status >= 200 && response.status < 300) {
            prompts.log.success("Server responded successfully (no auth required or already authenticated)")
            const body = await response.text()
            try {
              const json = JSON.parse(body)
              if (json.result?.serverInfo) {
                prompts.log.info(`Server info: ${JSON.stringify(json.result.serverInfo)}`)
              }
            } catch {
              // Not JSON, ignore
            }
          } else {
            prompts.log.warn(`Unexpected status: ${response.status}`)
            const body = await response.text().catch(() => "")
            if (body) {
              prompts.log.info(`Response body: ${body.substring(0, 500)}`)
            }
          }
        } catch (error) {
          spinner.stop("Connection failed", 1)
          prompts.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }

        prompts.outro("Debug complete")
      },
    })
  },
})

// MCP Registry Commands

export const McpRegistryCommand = cmd({
  command: "registry",
  aliases: ["reg"],
  describe: "browse the MCP registry of pre-configured servers",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Registry")

        const categories = McpRegistry.categories
        const categoryOptions = Object.entries(categories).map(([key, cat]) => ({
          label: `${cat.icon} ${cat.label}`,
          value: key as McpRegistry.Category,
          hint: cat.description,
        }))

        const category = await prompts.select({
          message: "Select category",
          options: [
            { label: "⭐ All", value: "all" as const, hint: "Show all available MCP servers" },
            ...categoryOptions,
          ],
        })
        if (prompts.isCancel(category)) throw new UI.CancelledError()

        let entries: McpRegistry.RegistryEntry[]
        if (category === "all") {
          entries = McpRegistry.registry
        } else {
          entries = McpRegistry.getByCategory(category)
        }

        // Filter by platform compatibility
        entries = entries.filter((entry) => McpRegistry.isCompatible(entry))

        if (entries.length === 0) {
          prompts.log.warn("No compatible MCP servers found for your platform")
          prompts.outro("Done")
          return
        }

        prompts.log.info(`\nFound ${entries.length} compatible MCP server(s):\n`)

        for (const entry of entries) {
          const featured = entry.featured ? "⭐ " : ""
          const stars = entry.stars ? ` ★ ${entry.stars}` : ""
          const compatible = McpRegistry.isCompatible(entry) ? "✓" : "✗"

          prompts.log.info(`${featured}${entry.name}${stars}`)
          prompts.log.info(`  ${entry.description}`)
          prompts.log.info(`  Category: ${categories[entry.category].label}`)
          prompts.log.info(`  Platform: ${compatible} ${entry.platform.join(", ")}`)
          prompts.log.info(`  Repository: ${entry.repository}`)
          prompts.log.info("")
        }

        prompts.outro("Use 'HopCoderX mcp install <name>' to add a server")
      },
    })
  },
})

export const McpInstallCommand = cmd({
  command: "install <name>",
  aliases: ["i"],
  describe: "install an MCP server from the registry",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server from registry",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Install MCP Server")

        const entry = McpRegistry.getByName(args.name)
        if (!entry) {
          prompts.log.error(`MCP server "${args.name}" not found in registry`)
          prompts.log.info("Available servers:")
          for (const e of McpRegistry.registry) {
            prompts.log.info(`  • ${e.name} - ${e.description}`)
          }
          prompts.outro("Done")
          return
        }

        // Check platform compatibility
        if (!McpRegistry.isCompatible(entry)) {
          prompts.log.error(`MCP server "${args.name}" is not compatible with your platform`)
          prompts.log.info(`Required platforms: ${entry.platform.join(", ")}`)
          prompts.outro("Done")
          return
        }

        const spinner = prompts.spinner()
        spinner.start(`Installing ${entry.name}...`)

        try {
          // Resolve config paths
          const [projectConfigPath, globalConfigPath] = await Promise.all([
            resolveMcpConfigPath(Instance.worktree),
            resolveMcpConfigPath(Global.Path.config, { global: true }),
          ])

          // Default to project config
          let configPath = projectConfigPath
          if (projectConfigPath !== globalConfigPath) {
            const scopeResult = await prompts.select({
              message: "Where to install?",
              options: [
                {
                  label: "Current project",
                  value: projectConfigPath,
                  hint: projectConfigPath,
                },
                {
                  label: "Global",
                  value: globalConfigPath,
                  hint: globalConfigPath,
                },
              ],
            })
            if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
            configPath = scopeResult
          }

          // Format the config
          const mcpConfig = McpRegistry.formatConfig(entry)

          // Add to config
          await updateMcpConfigEntry(entry.name, mcpConfig, configPath)

          spinner.stop(`✓ ${entry.name} installed successfully`)

          // Show setup instructions
          if (entry.setupInstructions) {
            prompts.log.info("\nSetup Instructions:")
            prompts.log.info(entry.setupInstructions)
          }

          prompts.log.success(`\nAdded to: ${configPath}`)
          prompts.outro("Installation complete")
        } catch (error) {
          spinner.stop(`Failed to install ${entry.name}`, 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Failed")
        }
      },
    })
  },
})

export const McpRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove an MCP server from configuration",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server to remove",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Remove MCP Server")

        const config = await Config.get()
        if (!config.mcp || !config.mcp[args.name]) {
          prompts.log.error(`MCP server "${args.name}" not found in configuration`)
          prompts.outro("Done")
          return
        }

        const confirm = await prompts.confirm({
          message: `Remove "${args.name}" from configuration?`,
          initialValue: false,
        })
        if (prompts.isCancel(confirm) || !confirm) {
          prompts.outro("Cancelled")
          return
        }

        // Find and update config file
        const candidates = [
          path.join(Instance.worktree, "hopcoderx.json"),
          path.join(Instance.worktree, "hopcoderx.jsonc"),
          path.join(Instance.worktree, ".hopcoderx", "hopcoderx.json"),
          path.join(Instance.worktree, ".hopcoderx", "hopcoderx.jsonc"),
          path.join(Global.Path.config, "hopcoderx.json"),
          path.join(Global.Path.config, "hopcoderx.jsonc"),
        ]

        let removed = false
        for (const configPath of candidates) {
          if (await Filesystem.exists(configPath)) {
            const text = await Filesystem.readText(configPath)
            const edits = modify(text, ["mcp", args.name], undefined, {
              formattingOptions: { tabSize: 2, insertSpaces: true },
            })
            if (edits.length > 0) {
              const result = applyEdits(text, edits)
              await Filesystem.write(configPath, result)
              removed = true
              prompts.log.success(`Removed from ${configPath}`)
              break
            }
          }
        }

        if (!removed) {
          prompts.log.warn("Could not find config file to update")
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpSetupCommand = cmd({
  command: "setup",
  describe: "setup pre-configured MCP bundles (e.g., adobe-suite)",
  builder: (yargs) =>
    yargs
      .positional("bundle", {
        describe: "bundle name to setup",
        type: "string",
        choices: ["adobe-suite"],
      })
      .option("platform", {
        describe: "Platform filter",
        type: "string",
        choices: ["windows", "macos"],
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Setup")

        const bundle = args.bundle || "adobe-suite"

        if (bundle === "adobe-suite") {
          prompts.log.info("Setting up Adobe Creative Suite MCP servers...")

          const currentPlatform = process.platform
          const platform = (args.platform as string) || (currentPlatform === "darwin" ? "macos" : "windows")

          const adobeMCPs: Record<string, string[]> = {
            windows: ["photoshop", "after-effects", "adobe-xd"],
            macos: ["after-effects", "illustrator", "indesign", "adobe-xd"],
          }

          const toInstall = adobeMCPs[platform] || []

          if (toInstall.length === 0) {
            prompts.log.warn(`No Adobe MCP servers available for platform: ${platform}`)
            prompts.outro("Done")
            return
          }

          prompts.log.info(`Platform: ${platform}`)
          prompts.log.info(`Will install: ${toInstall.join(", ")}\n`)

          for (const mcpName of toInstall) {
            const entry = McpRegistry.getByName(mcpName)
            if (!entry) {
              prompts.log.warn(`Skipping ${mcpName} - not found in registry`)
              continue
            }

            if (!McpRegistry.isCompatible(entry)) {
              prompts.log.warn(`Skipping ${mcpName} - not compatible with your platform`)
              continue
            }

            const spinner = prompts.spinner()
            spinner.start(`Installing ${mcpName}...`)

            try {
              const configPath = await resolveMcpConfigPath(Instance.worktree)
              const mcpConfig = McpRegistry.formatConfig(entry)
              await updateMcpConfigEntry(mcpName, mcpConfig, configPath)
              spinner.stop(`✓ ${mcpName} installed`)
            } catch (error) {
              spinner.stop(`✗ ${mcpName} failed`, 1)
              prompts.log.error(error instanceof Error ? error.message : String(error))
            }
          }

          prompts.log.info("\nAdobe Suite MCP servers installed!")
          prompts.log.info("Review the setup instructions for each server above.")
          prompts.log.info("Enable servers with: HopCoderX mcp list")
        }

        prompts.outro("Setup complete")
      },
    })
  },
})

export const McpConfigureCommand = cmd({
  command: "configure",
  describe: "configure MCP servers that require setup",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Server Configuration")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const needsConfig: Array<{
          name: string
          reason: string
          action: () => Promise<void>
        }> = []

        // Check each server for configuration issues
        for (const [name, mcp] of Object.entries(mcpServers)) {
          // Skip disabled servers
          if (typeof mcp === "object" && "enabled" in mcp && mcp.enabled === false) {
            continue
          }

          if (!isMcpConfigured(mcp)) continue

          // Check missing env vars
          const missingEnv = findMissingMcpEnvVars(mcp)
          if (missingEnv.length > 0) {
            needsConfig.push({
              name,
              reason: `Missing env vars: ${missingEnv.join(", ")}`,
              action: async () => {
                prompts.log.info(`Set the following environment variables:`)
                for (const envVar of missingEnv) {
                  const value = await prompts.password({
                    message: `Enter value for ${envVar}:`,
                  })
                  if (prompts.isCancel(value)) return
                  prompts.log.info(`  Add ${envVar} to your environment or .env file`)
                }
              },
            })
            continue
          }

          // Check OAuth status
          const authStatus = await MCP.getAuthStatus(name)
          if (authStatus === "not_authenticated" || authStatus === "expired") {
            needsConfig.push({
              name,
              reason: authStatus === "expired" ? "OAuth credentials expired" : "Requires OAuth authentication",
              action: async () => {
                const status = await MCP.authenticate(name)
                if (status.status === "failed" || status.status === "needs_client_registration") {
                  throw new Error(status.error ?? "Authentication failed")
                }
                if (status.status !== "connected") {
                  throw new Error(`Unexpected status: ${status.status}`)
                }
              },
            })
            continue
          }

          // Check client registration status
          const status = await MCP.status()
          if (status[name]?.status === "needs_client_registration") {
            needsConfig.push({
              name,
              reason: "Requires client registration (clientId)",
              action: async () => {
                prompts.log.info(`Add clientId to config for ${name}:`)
                prompts.log.info(
                  JSON.stringify(
                    {
                      mcp: { [name]: { type: "remote", url: isMcpRemote(mcp) ? mcp.url : "...", oauth: { clientId: "..." } } },
                    },
                    null,
                    2,
                  ),
                )
              },
            })
          }
        }

        if (needsConfig.length === 0) {
          prompts.log.success("All MCP servers are properly configured")
          prompts.outro("Done")
          return
        }

        prompts.log.info(`Found ${needsConfig.length} server(s) needing configuration:\n`)
        for (const server of needsConfig) {
          prompts.log.info(`  • ${server.name}: ${server.reason}`)
        }

        const proceed = await prompts.confirm({
          message: "Configure these servers now?",
        })

        if (prompts.isCancel(proceed) || !proceed) {
          prompts.outro("Cancelled")
          return
        }

        for (const server of needsConfig) {
          prompts.log.info(`\nConfiguring ${server.name}...`)
          try {
            await server.action()
            prompts.log.success(`  ✓ ${server.name} configured`)
          } catch (error) {
            prompts.log.error(`  ✗ ${server.name}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        prompts.log.success("Configuration complete")
        prompts.outro("Done")
      },
    })
  },
})

export const McpBuiltinsCommand = cmd({
  command: "builtins",
  aliases: ["b"],
  describe: "list or toggle built-in MCP servers",
  builder: (yargs) =>
    yargs
      .option("enable", {
        type: "string",
        describe: "enable a built-in server by ID (e.g. builtin:github)",
      })
      .option("disable", {
        type: "string",
        describe: "disable a built-in server by ID",
      })
      .option("category", {
        type: "string",
        describe: "filter by category (core, vcs, database, search, communication, browser, ai)",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Built-in MCP Servers")

        const currentStatus = await MCP.status()

        if (args.enable) {
          const id = args.enable.startsWith("builtin:") ? args.enable : `builtin:${args.enable}`
          const config = await Config.get()
          const configPath = await resolveMcpConfigPath(Global.Path.config, { global: true })

          // Try to build enabled entry (works for both built-in and custom servers)
          const mcpConfig = buildEnabledMcpEntry(id, config.mcp)
          if (!mcpConfig) {
            prompts.log.error(`Unknown or not configured server: ${id}`)
            prompts.outro("Done")
            return
          }

          // If it's a built-in that requires credentials, check env vars
          const entry = McpBuiltins.getById(id)
          if (entry?.requiresCredentials) {
            const missing = (entry.requiredEnvVars ?? []).filter((k) => !process.env[k])
            if (missing.length) {
              prompts.log.error(`Missing env vars: ${missing.join(", ")}`)
              if (entry.setupGuide) prompts.log.info(entry.setupGuide)
              prompts.outro("Done")
              return
            }
          }

          // Only add to MCP runtime if it's a full config (not just { enabled: true })
          if ("type" in mcpConfig) {
            await MCP.add(id, mcpConfig)
          }
          await updateMcpConfigEntry(id, mcpConfig, configPath)
          const displayName = entry ? `${entry.icon} ${entry.name}` : id
          prompts.log.success(`Enabled ${displayName}`)
          prompts.outro("Done")
          return
        }

        if (args.disable) {
          const id = args.disable.startsWith("builtin:") ? args.disable : `builtin:${args.disable}`
          await MCP.disconnect(id)
          const config = await Config.get()
          const configPath = await resolveMcpConfigPath(Global.Path.config, { global: true })
          await updateMcpConfigEntry(id, buildDisabledMcpEntry(id, config.mcp), configPath)
          prompts.log.success(`Disabled ${id}`)
          prompts.outro("Done")
          return
        }

        // List mode
        let entries = McpBuiltins.catalog
        if (args.category) {
          entries = entries.filter((e) => e.category === args.category)
        }

        const launchModeLabel = { always: "🟢 always", "on-demand": "🔵 on-demand", manual: "⚪ manual" }

        for (const entry of entries) {
          const s = currentStatus[entry.id]
          const statusLabel = s ? `[${s.status}]` : "[not running]"
          prompts.log.info(`${entry.icon} ${entry.name.padEnd(20)} ${launchModeLabel[entry.launchMode]}  ${statusLabel}`)
          prompts.log.info(`   ${entry.id}`)
          prompts.log.info(`   ${entry.description}`)
          if (entry.requiresCredentials && entry.requiredEnvVars) {
            const missing = entry.requiredEnvVars.filter((k) => !process.env[k])
            if (missing.length) {
              prompts.log.warn(`   Missing env: ${missing.join(", ")}`)
            } else {
              prompts.log.info(`   Credentials: ✓ configured`)
            }
          }
          prompts.log.info("")
        }

        prompts.log.info("Legend: 🟢 always-on  🔵 auto-detected  ⚪ manual")
        prompts.log.info("Use --enable <id> to enable / --disable <id> to disable")
        prompts.outro("Done")
      },
    })
  },
})

export const McpTestCommand = cmd({
  command: "test <name>",
  describe: "test MCP server connection",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Server Test")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const serverConfig = mcpServers[args.name]

        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        if (!isMcpConfigured(serverConfig)) {
          prompts.log.error(`MCP server is disabled: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const spinner = prompts.spinner()
        spinner.start(`Testing connection to ${args.name}...`)

        try {
          // Disconnect first to get fresh connection
          await MCP.disconnect(args.name)

          // Reconnect
          await MCP.connect(args.name)

          // Check status
          const status = await MCP.status()
          const serverStatus = status[args.name]

          if (serverStatus?.status === "connected") {
            spinner.stop(`Connection successful!`)

            // Get tools count
            const clients = await MCP.clients()
            const client = clients[args.name]
            if (client) {
              const tools = await client.listTools()
              prompts.log.success(`Connected with ${tools.tools.length} tool(s)`)
            }
          } else if (serverStatus?.status === "needs_auth") {
            spinner.stop("Authentication required", 1)
            prompts.log.warn("Server requires authentication")
            prompts.log.info(`Run: hopcoderx mcp auth ${args.name}`)
          } else if (serverStatus?.status === "needs_client_registration") {
            spinner.stop("Client registration required", 1)
            prompts.log.warn("Server requires client registration")
            prompts.log.info(`Add clientId to your config for ${args.name}`)
          } else if (serverStatus?.status === "failed") {
            spinner.stop("Connection failed", 1)
            prompts.log.error(serverStatus.error ?? "Unknown error")
          } else {
            spinner.stop("Connection failed", 1)
            prompts.log.error("Unknown error")
          }
        } catch (error) {
          spinner.stop("Connection failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpReloadCommand = cmd({
  command: "reload <name>",
  describe: "reload an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Server Reload")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const serverConfig = mcpServers[args.name]

        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${args.name}`)
          prompts.outro("Done")
          return
        }

        if (!isMcpConfigured(serverConfig)) {
          prompts.log.error(`MCP server is disabled: ${args.name}`)
          prompts.outro("Done")
          return
        }

        const spinner = prompts.spinner()
        spinner.start(`Reloading ${args.name}...`)

        try {
          // Disconnect
          await MCP.disconnect(args.name)

          // Reconnect
          await MCP.connect(args.name)

          // Check status
          const status = await MCP.status()
          const serverStatus = status[args.name]

          if (serverStatus?.status === "connected") {
            spinner.stop(`Reloaded successfully!`)
            prompts.log.success(`${args.name} is connected`)
          } else if (serverStatus?.status === "failed") {
            spinner.stop("Reload failed", 1)
            prompts.log.error(serverStatus.error ?? "Failed to reconnect")
          } else if (serverStatus?.status === "needs_auth") {
            spinner.stop("Authentication required", 1)
            prompts.log.warn(`${args.name} needs authentication`)
            prompts.log.info(`Run: hopcoderx mcp auth ${args.name}`)
          } else {
            spinner.stop(`Reloaded with status: ${serverStatus?.status}`, 1)
          }
        } catch (error) {
          spinner.stop("Reload failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }

        prompts.outro("Done")
      },
    })
  },
})
