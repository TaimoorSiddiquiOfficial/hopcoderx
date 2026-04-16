import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { SkillsMarketplace, scanAndRecommend, autoInstallSkills } from "../../skills/marketplace"
import { SkillDiscovery } from "../../skills/discovery"
import { SnippetExpansion } from "../../skills/snippets"
import { SkillRegistry } from "../../skills/skills"
import { Log } from "../../util/log"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "server" })

export const SkillsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List available skills",
        description: "Get a list of all available HopCoderX skills, including built-in and installed marketplace skills.",
        operationId: "skills.list",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      description: z.string(),
                      available: z.boolean(),
                      source: z.enum(["builtin", "marketplace", "local"]),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = SkillRegistry.available().map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          available: s.isAvailable(),
          source: "builtin",
        }))
        return c.json(skills)
      },
    )
    .get(
      "/marketplace/search",
      describeRoute({
        summary: "Search skills marketplace",
        description: "Search for skills in the npm marketplace.",
        operationId: "skills.marketplace.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      name: z.string(),
                      description: z.string(),
                      version: z.string(),
                      downloads: z.number().optional(),
                      author: z.string().optional(),
                      homepage: z.string().optional(),
                      npmUrl: z.string(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().optional().meta({ description: "Search query" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const marketplace = new SkillsMarketplace()
        const results = await marketplace.search(query.q)
        return c.json(results)
      },
    )
    .get(
      "/marketplace/:packageName",
      describeRoute({
        summary: "Get skill package info",
        description: "Get details for a specific skill package from the marketplace.",
        operationId: "skills.marketplace.info",
        responses: {
          200: {
            description: "Package info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                    version: z.string(),
                    author: z.string().optional(),
                    homepage: z.string().optional(),
                    npmUrl: z.string(),
                  }),
                ),
              },
            },
          },
          404: {
            description: "Package not found",
          },
        },
      }),
      validator(
        "param",
        z.object({
          packageName: z.string(),
        }),
      ),
      async (c) => {
        const packageName = c.req.valid("param").packageName
        const marketplace = new SkillsMarketplace()
        const info = await marketplace.info(packageName)
        if (!info) return c.json({ error: "Package not found" }, 404)
        return c.json(info)
      },
    )
    .post(
      "/marketplace/install",
      describeRoute({
        summary: "Install skill from marketplace",
        description: "Install a skill package from npm into the HopCoderX skills directory.",
        operationId: "skills.marketplace.install",
        responses: {
          200: {
            description: "Skill installed",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    version: z.string(),
                    installedAt: z.string(),
                    path: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          packageName: z.string(),
          version: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const marketplace = new SkillsMarketplace()
        const result = await marketplace.install(body.packageName, body.version)
        return c.json({
          name: result.name,
          version: result.version,
          installedAt: result.installedAt.toISOString(),
          path: result.path,
        })
      },
    )
    .post(
      "/marketplace/uninstall",
      describeRoute({
        summary: "Uninstall skill",
        description: "Remove an installed skill package.",
        operationId: "skills.marketplace.uninstall",
        responses: {
          200: {
            description: "Skill uninstalled",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          packageName: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const marketplace = new SkillsMarketplace()
        await marketplace.uninstall(body.packageName)
        return c.json(true)
      },
    )
    .get(
      "/marketplace/installed",
      describeRoute({
        summary: "List installed skills",
        description: "Get a list of all installed marketplace skills.",
        operationId: "skills.marketplace.installed",
        responses: {
          200: {
            description: "Installed skills",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      name: z.string(),
                      version: z.string(),
                      manifest: z.object({
                        id: z.string(),
                        name: z.string(),
                        description: z.string(),
                        version: z.string(),
                        requiredEnv: z.array(z.string()),
                        permissions: z.array(z.string()),
                      }),
                      installedAt: z.string(),
                      path: z.string(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const marketplace = new SkillsMarketplace()
        const installed = await marketplace.list()
        return c.json(installed)
      },
    )
    .get(
      "/discover",
      describeRoute({
        summary: "Discover skills for project",
        description: "Scan the current project and recommend relevant skills based on detected frameworks, tools, and configuration.",
        operationId: "skills.discover",
        responses: {
          200: {
            description: "Discovered skills and recommendations",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    discovered: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        description: z.string(),
                        source: z.enum(["project", "github", "local", "marketplace"]),
                        confidence: z.number(),
                        recommendations: z.array(
                          z.object({
                            package: z.string(),
                            reason: z.string(),
                            priority: z.enum(["high", "medium", "low"]),
                          }),
                        ),
                      }),
                    ),
                    allRecommendations: z.array(
                      z.object({
                        package: z.string(),
                        reason: z.string(),
                        priority: z.enum(["high", "medium", "low"]),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await scanAndRecommend(Instance.directory)
        return c.json(result)
      },
    )
    .post(
      "/discover/auto-install",
      describeRoute({
        summary: "Auto-install recommended skills",
        description: "Automatically install high-priority skills based on project analysis.",
        operationId: "skills.discover.autoInstall",
        responses: {
          200: {
            description: "List of installed packages",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const installed = await autoInstallSkills(Instance.directory)
        return c.json(installed)
      },
    )
    .get(
      "/snippets",
      describeRoute({
        summary: "List snippets",
        description: "Get all available code snippets.",
        operationId: "skills.snippets.list",
        responses: {
          200: {
            description: "List of snippets",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      prefix: z.string(),
                      description: z.string(),
                      scope: z.array(z.string()),
                      tags: z.array(z.string()),
                      source: z.enum(["builtin", "custom", "project"]),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          language: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const snippets = SnippetExpansion.all(query.language)
        return c.json(
          snippets.map((s) => ({
            id: s.id,
            prefix: s.prefix,
            description: s.description,
            scope: s.scope,
            tags: s.tags,
            source: s.source,
          })),
        )
      },
    )
    .get(
      "/snippets/suggest",
      describeRoute({
        summary: "Suggest snippets",
        description: "Get snippet suggestions based on a search query.",
        operationId: "skills.snippets.suggest",
        responses: {
          200: {
            description: "Snippet suggestions",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      prefix: z.string(),
                      description: z.string(),
                      scope: z.array(z.string()),
                      tags: z.array(z.string()),
                      source: z.enum(["builtin", "custom", "project"]),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().meta({ description: "Search query" }),
          language: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const suggestions = SnippetExpansion.suggest(query.q, query.language)
        return c.json(suggestions)
      },
    )
    .post(
      "/snippets/expand",
      describeRoute({
        summary: "Expand snippet",
        description: "Expand a snippet template with provided variables.",
        operationId: "skills.snippets.expand",
        responses: {
          200: {
            description: "Expanded snippet",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    text: z.string(),
                    pendingVariables: z.array(z.string()),
                    cursorPosition: z.number().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          identifier: z.string().meta({ description: "Snippet ID or prefix" }),
          variables: z.record(z.string(), z.string()).optional(),
          language: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        try {
          const result = SnippetExpansion.expand(body.identifier, body.variables, body.language)
          return c.json(result)
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
        }
      },
    )
    .post(
      "/snippets/custom",
      describeRoute({
        summary: "Save custom snippet",
        description: "Save a custom snippet to user configuration.",
        operationId: "skills.snippets.saveCustom",
        responses: {
          200: {
            description: "Snippet saved",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          id: z.string(),
          prefix: z.string(),
          description: z.string(),
          body: z.union([z.string(), z.array(z.string())]),
          variables: z
            .array(
              z.object({
                name: z.string(),
                default: z.string().optional(),
                description: z.string().optional(),
              }),
            )
            .optional(),
          scope: z.array(z.string()),
          tags: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        await SnippetExpansion.saveCustom(body)
        return c.json(true)
      },
    )
    .delete(
      "/snippets/custom/:id",
      describeRoute({
        summary: "Delete custom snippet",
        description: "Remove a custom snippet.",
        operationId: "skills.snippets.deleteCustom",
        responses: {
          200: {
            description: "Snippet deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const id = c.req.valid("param").id
        const deleted = await SnippetExpansion.deleteCustom(id)
        return c.json(deleted)
      },
    )
    .post(
      "/execute",
      describeRoute({
        summary: "Execute skill tool",
        description: "Execute a tool within a loaded skill.",
        operationId: "skills.execute",
        responses: {
          200: {
            description: "Tool execution result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    output: z.string(),
                    success: z.boolean(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          skillId: z.string(),
          toolName: z.string(),
          args: z.record(z.string(), z.any()),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const { Skills } = await import("../../skills/framework")
        try {
          const output = await Skills.execute(body.skillId, body.toolName, body.args)
          return c.json({ output, success: true })
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e), success: false }, 400)
        }
      },
    ),
)
