import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { HubCatalog } from "../../hub/catalog"
import { HubManifest } from "../../hub/manifest"
import { HubStatus } from "../../hub/status"
import { McpRegistry } from "../../mcp/registry"
import { MCP } from "../../mcp"
import { buildDisabledMcpEntry, buildEnabledMcpEntry, resolveMcpConfigPath, updateMcpConfigEntry } from "../../mcp/config-file"
import { SkillsMarketplace } from "../../skills/marketplace"
import { Instance } from "../../project/instance"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

function resolveMcpName(id: string) {
  return id.startsWith("mcp:") ? id.slice(4) : id
}

export const HubRoutes = lazy(() =>
  new Hono()
    .get(
      "/catalog",
      describeRoute({
        summary: "List hub catalog items",
        description: "Return a unified catalog of MCP servers and skills with install and readiness metadata.",
        operationId: "hub.catalog.list",
        responses: {
          200: {
            description: "Hub catalog items",
            content: {
              "application/json": {
                schema: resolver(z.array(HubCatalog.Item)),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          kind: HubManifest.Kind.optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const config = await Config.get()
        const items = await HubCatalog.list({
          configMcp: config.mcp,
        })
        return c.json(query.kind ? items.filter((item) => item.manifest.kind === query.kind) : items)
      },
    )
    .get(
      "/catalog/:id",
      describeRoute({
        summary: "Get hub catalog item",
        description: "Return a single hub catalog item by id or MCP/skill name.",
        operationId: "hub.catalog.get",
        responses: {
          200: {
            description: "Hub catalog item",
            content: {
              "application/json": {
                schema: resolver(HubCatalog.Item),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const config = await Config.get()
        const item = await HubCatalog.get(id, {
          configMcp: config.mcp,
        })
        if (!item) return c.json({ error: "Hub item not found" }, 404)
        return c.json(item)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get hub MCP status",
        description: "Return readiness status for all registry MCPs without requiring the UI to compute it client-side.",
        operationId: "hub.status",
        responses: {
          200: {
            description: "Hub MCP status entries",
            content: {
              "application/json": {
                schema: resolver(z.array(HubStatus.MCPState)),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const states = await HubStatus.resolveAllMcp({
          configMcp: config.mcp,
        })
        return c.json(states)
      },
    )
    .post(
      "/install",
      describeRoute({
        summary: "Install a hub item",
        description: "Install an MCP from the registry or a marketplace skill package.",
        operationId: "hub.install",
        responses: {
          200: {
            description: "Installed hub item result",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.any())),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          kind: HubManifest.Kind,
          id: z.string(),
          packageName: z.string().optional(),
          version: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")

        if (body.kind === "mcp") {
          const name = resolveMcpName(body.id)
          const entry = McpRegistry.getByName(name)
          if (!entry) return c.json({ error: "MCP item not found" }, 404)
          const initialConfig = McpRegistry.formatConfig(entry)
          const status = await HubStatus.resolveCurrentMcp(entry, {
            config: {
              ...initialConfig,
              enabled: true,
            },
          })
          const config = {
            ...initialConfig,
            enabled: status.effectiveEnabled,
          }
          const result = await MCP.add(name, config)
          const configPath = await resolveMcpConfigPath(Instance.directory)
          await updateMcpConfigEntry(name, config, configPath)
          return c.json({
            kind: "mcp" as const,
            id: body.id,
            name,
            enabled: config.enabled,
            status: result.status,
          })
        }

        if (body.kind === "skill") {
          const packageName = body.packageName ?? body.id
          const marketplace = new SkillsMarketplace()
          const result = await marketplace.install(packageName, body.version)
          return c.json({
            kind: "skill" as const,
            id: body.id,
            packageName: result.name,
            version: result.version,
            path: result.path,
          })
        }

        return c.json({ error: `Install not supported for kind '${body.kind}' yet` }, 400)
      },
    )
    .post(
      "/enable",
      describeRoute({
        summary: "Enable a hub MCP item",
        description: "Enable an installed MCP item while respecting auth-aware auto-disable rules.",
        operationId: "hub.enable",
        responses: {
          200: {
            description: "Updated MCP config",
            content: {
              "application/json": {
                schema: resolver(Config.Mcp),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("json")
        const name = resolveMcpName(id)
        const config = await Config.get()
        const next = buildEnabledMcpEntry(name, config.mcp)
        if (!next) return c.json({ error: "MCP item not found" }, 404)
        const entry = McpRegistry.getByName(name)
        const resolved = entry ? await HubStatus.resolveCurrentMcp(entry, { config: next }) : undefined
        const finalConfig = {
          ...next,
          enabled: resolved?.effectiveEnabled ?? next.enabled,
        }
        const configPath = await resolveMcpConfigPath(Instance.directory)
        await updateMcpConfigEntry(name, finalConfig, configPath)
        return c.json(finalConfig)
      },
    )
    .post(
      "/disable",
      describeRoute({
        summary: "Disable a hub MCP item",
        description: "Disable an installed MCP item.",
        operationId: "hub.disable",
        responses: {
          200: {
            description: "Disabled MCP config",
            content: {
              "application/json": {
                schema: resolver(z.union([Config.Mcp, z.object({ enabled: z.boolean() })])),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("json", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("json")
        const name = resolveMcpName(id)
        const config = await Config.get()
        const next = buildDisabledMcpEntry(name, config.mcp)
        if (!next) return c.json({ error: "MCP item not found" }, 404)
        const configPath = await resolveMcpConfigPath(Instance.directory)
        await updateMcpConfigEntry(name, next, configPath)
        return c.json(next)
      },
    )
    .post(
      "/auth/start",
      describeRoute({
        summary: "Start hub MCP auth",
        description: "Start the auth flow for an MCP item in the hub catalog.",
        operationId: "hub.auth.start",
        responses: {
          200: {
            description: "Auth start result",
            content: {
              "application/json": {
                schema: resolver(z.object({ authorizationUrl: z.string() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("json")
        const name = resolveMcpName(id)
        const entry = McpRegistry.getByName(name)
        if (!entry) return c.json({ error: "MCP item not found" }, 404)
        const auth = McpRegistry.getAuth(entry)
        if (auth.mode !== "oauth") {
          return c.json({ error: "This MCP item does not expose an OAuth auth flow." }, 400)
        }
        return c.json(await MCP.startAuth(name))
      },
    )
    .post(
      "/auth/remove",
      describeRoute({
        summary: "Remove hub MCP auth",
        description: "Remove stored auth for an MCP item in the hub catalog.",
        operationId: "hub.auth.remove",
        responses: {
          200: {
            description: "Stored auth removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("json", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("json")
        const name = resolveMcpName(id)
        const entry = McpRegistry.getByName(name)
        if (!entry) return c.json({ error: "MCP item not found" }, 404)
        await MCP.removeAuth(name)
        return c.json({ success: true as const })
      },
    ),
)
