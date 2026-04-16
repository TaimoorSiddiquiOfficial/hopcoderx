import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { HubCatalog } from "../../hub/catalog"
import { HubBundles } from "../../hub/bundles"
import { HubEcosystem } from "../../hub/ecosystem"
import { HubInstall } from "../../hub/install"
import { HubManifest } from "../../hub/manifest"
import { HubPresets } from "../../hub/presets"
import { HubStatus } from "../../hub/status"
import { HubWorkflows } from "../../hub/workflows"
import { McpRegistry } from "../../mcp/registry"
import { MCP } from "../../mcp"
import {
  buildDisabledMcpEntry,
  buildEnabledMcpEntry,
  resolveMcpConfigPath,
  updateMcpConfigEntry,
  type PersistedMcpEntry,
} from "../../mcp/config-file"
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
      "/workflows",
      describeRoute({
        summary: "List workflow entries",
        description: "Return opinionated workflow aliases built on top of Hub presets and bundles.",
        operationId: "hub.workflows.list",
        responses: {
          200: {
            description: "Workflow entries",
            content: {
              "application/json": {
                schema: resolver(z.array(HubWorkflows.Workflow)),
              },
            },
          },
        },
      }),
      validator("query", z.object({ query: z.string().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(HubWorkflows.list(query.query))
      },
    )
    .get(
      "/workflows/:id",
      describeRoute({
        summary: "Get workflow entry",
        description: "Return an opinionated workflow alias by id, name, or alias.",
        operationId: "hub.workflows.get",
        responses: {
          200: {
            description: "Workflow entry",
            content: {
              "application/json": {
                schema: resolver(HubWorkflows.Workflow),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const workflow = HubWorkflows.get(id)
        if (!workflow) return c.json({ error: "Workflow not found" }, 404)
        return c.json(workflow)
      },
    )
    .get(
      "/ecosystem",
      describeRoute({
        summary: "List ecosystem entries",
        description: "Return curated official and community ecosystem references for Hub-adjacent resources.",
        operationId: "hub.ecosystem.list",
        responses: {
          200: {
            description: "Ecosystem entries",
            content: {
              "application/json": {
                schema: resolver(z.array(HubEcosystem.ResolvedEntry)),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          section: HubEcosystem.Section.optional(),
          kind: HubEcosystem.Kind.optional(),
          query: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const config = await Config.get()
        return c.json(
          await HubEcosystem.listResolved({
            section: query.section,
            kind: query.kind,
            query: query.query,
            configMcp: config.mcp,
          }),
        )
      },
    )
    .get(
      "/ecosystem/:id",
      describeRoute({
        summary: "Get ecosystem entry",
        description: "Return one curated ecosystem reference by id or name.",
        operationId: "hub.ecosystem.get",
        responses: {
          200: {
            description: "Ecosystem entry",
            content: {
              "application/json": {
                schema: resolver(HubEcosystem.ResolvedEntry),
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
        const item = await HubEcosystem.getResolved(id, {
          configMcp: config.mcp,
        })
        if (!item) return c.json({ error: "Ecosystem item not found" }, 404)
        return c.json(item)
      },
    )
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
          view: HubCatalog.View.optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const config = await Config.get()
        const items = await HubCatalog.list({
          configMcp: config.mcp,
          view: query.view,
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
          view: "all",
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
          kind: z.union([HubManifest.Kind, z.literal("workflow")]),
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
          const result = await HubInstall.installRegistryMcp(name, {
            directory: Instance.directory,
            configMcp: (await Config.get()).mcp,
          })
          return c.json({
            kind: "mcp" as const,
            id: body.id,
            name: result.name,
            enabled: result.enabled,
            readiness: result.readiness,
            reason: result.reason,
          })
        }

        if (body.kind === "skill") {
          const packageName = body.packageName ?? body.id
          const marketplace = new SkillsMarketplace()
          const result = await marketplace.install(packageName, body.version)
          const config = await Config.get()
          const embedded = await HubInstall.installSkillEmbeddedMcp(result.manifest, {
            directory: Instance.directory,
            configMcp: config.mcp,
          })
          return c.json({
            kind: "skill" as const,
            id: body.id,
            packageName: result.name,
            version: result.version,
            path: result.path,
            embeddedMcp: embedded,
          })
        }

        if (body.kind === "bundle") {
          const bundle = HubBundles.get(body.id)
          if (!bundle) return c.json({ error: "Bundle item not found" }, 404)
          const config = await Config.get()
          const installed = await HubInstall.installBundle(bundle, {
            directory: Instance.directory,
            configMcp: config.mcp,
          })
          return c.json({
            kind: "bundle" as const,
            id: bundle.id,
            name: bundle.name,
            items: installed.items,
            recommendedAgent: installed.recommendedAgent,
            aliases: installed.aliases,
            starterPrompts: installed.starterPrompts,
          })
        }

        if (body.kind === "preset") {
          const preset = HubPresets.get(body.id)
          if (!preset) return c.json({ error: "Preset item not found" }, 404)
          const config = await Config.get()
          const installed = await HubInstall.installPreset(preset, {
            directory: Instance.directory,
            configMcp: config.mcp,
          })
          return c.json({
            kind: "preset" as const,
            id: preset.id,
            name: preset.name,
            items: installed.items,
            onboarding: installed.onboarding,
          })
        }

        if (body.kind === "workflow") {
          const workflow = HubWorkflows.get(body.id)
          if (!workflow) return c.json({ error: "Workflow item not found" }, 404)
          const preset = HubWorkflows.presetFor(workflow)
          if (!preset) return c.json({ error: "Workflow preset not found" }, 404)
          const config = await Config.get()
          const installed = await HubInstall.installPreset(preset, {
            directory: Instance.directory,
            configMcp: config.mcp,
          })
          return c.json({
            kind: "workflow" as const,
            id: workflow.id,
            name: workflow.name,
            presetID: workflow.presetID,
            recommendedAgent: workflow.recommendedAgent,
            starterPrompt: workflow.starterPrompt,
            items: installed.items,
            onboarding: installed.onboarding,
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
        const finalConfig: PersistedMcpEntry =
          "type" in next
            ? {
                ...next,
                enabled: resolved?.effectiveEnabled ?? next.enabled,
              }
            : {
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
