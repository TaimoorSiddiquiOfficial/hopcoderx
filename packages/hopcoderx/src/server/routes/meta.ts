import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { Vcs } from "../../project/vcs"
import { Command } from "../../command"
import { Agent } from "../../agent/agent"
import { Skill } from "../../skill/skill"
import { LSP } from "../../lsp"
import { Format } from "../../format"
import { Log } from "../../util/log"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

export const MetaRoutes = lazy(() =>
  new Hono()
    .post(
      "/instance/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose the current HopCoderX instance, releasing all resources.",
        operationId: "instance.dispose",
        responses: {
          200: {
            description: "Instance disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.dispose()
        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get paths",
        description:
          "Retrieve the current working directory and related path information for the HopCoderX instance.",
        operationId: "path.get",
        responses: {
          200: {
            description: "Path",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                      worktree: z.string(),
                      directory: z.string(),
                    })
                    .meta({
                      ref: "Path",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    )
    .get(
      "/vcs",
      describeRoute({
        summary: "Get VCS info",
        description:
          "Retrieve version control system (VCS) information for the current project, such as git branch.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const branch = await Vcs.branch()
        return c.json({
          branch,
        })
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List commands",
        description: "Get a list of all available commands in the HopCoderX system.",
        operationId: "command.list",
        responses: {
          200: {
            description: "List of commands",
            content: {
              "application/json": {
                schema: resolver(Command.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(commands)
      },
    )
    .post(
      "/log",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "app.log",
        responses: {
          200: {
            description: "Log entry written successfully",
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
          service: z.string().meta({ description: "Service name for the log entry" }),
          level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
          message: z.string().meta({ description: "Log message" }),
          extra: z
            .record(z.string(), z.any())
            .optional()
            .meta({ description: "Additional metadata for the log entry" }),
        }),
      ),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        const logger = Log.create({ service })

        switch (level) {
          case "debug":
            logger.debug(message, extra)
            break
          case "info":
            logger.info(message, extra)
            break
          case "error":
            logger.error(message, extra)
            break
          case "warn":
            logger.warn(message, extra)
            break
        }

        return c.json(true)
      },
    )
    .get(
      "/agent",
      describeRoute({
        summary: "List agents",
        description: "Get a list of all available AI agents in the HopCoderX system.",
        operationId: "app.agents",
        responses: {
          200: {
            description: "List of agents",
            content: {
              "application/json": {
                schema: resolver(Agent.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const modes = await Agent.list()
        return c.json(modes)
      },
    )
    .get(
      "/skill",
      describeRoute({
        summary: "List skills",
        description: "Get a list of all available skills in the HopCoderX system.",
        operationId: "app.skills",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(Skill.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
    )
    .get(
      "/lsp",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await LSP.status())
      },
    )
    .get(
      "/formatter",
      describeRoute({
        summary: "Get formatter status",
        description: "Get formatter status",
        operationId: "formatter.status",
        responses: {
          200: {
            description: "Formatter status",
            content: {
              "application/json": {
                schema: resolver(Format.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Format.status())
      },
    )
    .get(
      "/telemetry",
      describeRoute({
        summary: "Get telemetry metrics",
        description: "Return per-tool usage stats and recent spans collected since process start.",
        operationId: "telemetry.metrics",
        responses: {
          200: {
            description: "Telemetry metrics snapshot",
            content: {
              "application/json": {
                schema: resolver(z.object({}).passthrough()),
              },
            },
          },
        },
      }),
      async (c) => {
        const { Telemetry } = await import("../../telemetry/telemetry")
        const metrics = Telemetry.metrics()
        return c.json({
          ...metrics,
          latency: Telemetry.latencySummary(),
          slowestTools: Telemetry.slowestTools(5),
          modelPerf: Telemetry.modelPerf(),
        })
      },
    )
    .get(
      "/quota",
      describeRoute({
        tags: ["meta"],
        summary: "Get quota/cost status across all providers",
        responses: {
          200: {
            description: "Quota status",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  totalCostUSD: z.number(),
                  providers: z.array(z.object({
                    providerID: z.string(),
                    costUSD: z.number(),
                    used: z.number(),
                    exceeded: z.boolean(),
                    warning: z.string().optional(),
                  })),
                })),
              },
            },
          },
        },
      }),
      async (c) => {
        const { QuotaTracker } = await import("../../telemetry/quota")
        const statuses = QuotaTracker.getAllStatuses()
        let totalCostUSD = 0
        const providers: Array<{ providerID: string; costUSD: number; used: number; exceeded: boolean; warning?: string }> = []
        for (const [, status] of statuses) {
          totalCostUSD += status.costUSD
          providers.push({
            providerID: status.providerID,
            costUSD: status.costUSD,
            used: status.used,
            exceeded: status.exceeded,
            warning: status.warning,
          })
        }
        return c.json({ totalCostUSD, providers })
      },
    )
    .get(
      "/quota/:sessionID",
      describeRoute({
        tags: ["meta"],
        summary: "Get cost breakdown for a specific session",
        responses: {
          200: {
            description: "Session cost",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  sessionID: z.string(),
                  totalTokens: z.number(),
                  totalCostUSD: z.number(),
                  providers: z.array(z.object({
                    providerID: z.string(),
                    tokens: z.number(),
                    costUSD: z.number(),
                  })),
                })),
              },
            },
          },
        },
      }),
      async (c) => {
        const { QuotaTracker } = await import("../../telemetry/quota")
        const sessionID = c.req.param("sessionID")
        const usage = QuotaTracker.getSessionUsage(sessionID)
        return c.json({ sessionID, ...usage })
      },
    ),
)
