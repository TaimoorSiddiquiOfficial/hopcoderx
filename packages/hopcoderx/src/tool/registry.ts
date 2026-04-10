import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@hopcoderx/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { PlanExitTool, PlanEnterTool } from "./plan"
import { ApplyPatchTool } from "./apply_patch"
import { SemanticSearchTool } from "./semanticsearch"
import { SwarmTool } from "./swarm"
import { VisualDebugTool } from "./visualdebug"
import { Glob } from "../util/glob"
import { TestgenTool } from "./testgen"
import { DocgenTool } from "./docgen"
import { DepauditTool } from "./depaudit"
import { CodeVulnScanTool } from "./codevulnscan"
import { RecallMemoryTool, RememberTool } from "./codemem"
import { ImageUnderstandingTool } from "./imageunderstand"
import { DocUnderstandingTool } from "./docunderstand"
import { AudioTranscriptionTool } from "./transcribe"
import { ImageGenTool } from "./imagegen"
import { TTSTool } from "./tts"
import { TavilySearchTool } from "./tavily"
import { ExaSearchTool } from "./exa"
import { FirecrawlTool } from "./firecrawl"
import { VideoGenTool } from "./videogen"
import { AiDebugTool } from "./aidebug"
import { ArchDiagramTool } from "./archdiagram"
import { DuckDuckGoSearchTool } from "./duckduckgo"
import { MultiEditTool } from "./multiedit"
import { GitTool } from "./git"
import { HttpTool } from "./http"
import { PackageTool } from "./package"
import { EnvTool } from "./env"
import { ReviewTool } from "./review"
import { ConfigTool } from "./config"
import { DatabaseTool } from "./database"
import { BrowserTool } from "./browser"
import { RefactorTool } from "./refactor"
import { DeployTool } from "./deploy"
import { CacheTool } from "./cache"
import { ComposeTool } from "./compose"
import { VoiceInputTool } from "./voice"
import { CanvasTool } from "./canvas"
import { McpControlTool } from "./mcp-control"

// ─── Capability map ────────────────────────────────────────────────────────
// Centralised capability declarations for built-in tools so individual tool
// files don't need to be changed.  byCapability() merges this at query time.
const TOOL_CAPABILITIES: Partial<Record<string, Tool.Info["capabilities"]>> = {
  bash: ["execution", "filesystem"],
  edit: ["filesystem"],
  write: ["filesystem"],
  multiedit: ["filesystem"],
  apply_patch: ["filesystem"],
  read: ["read-only", "filesystem"],
  glob: ["read-only", "filesystem"],
  grep: ["read-only", "filesystem"],
  webfetch: ["network"],
  websearch: ["network"],
  http: ["network"],
  "tavily-search": ["network"],
  "exa-search": ["network"],
  firecrawl: ["network"],
  duckduckgo_search: ["network"],
  "generate-image": ["network", "ai"],
  speak: ["network", "ai"],
  transcribe: ["network", "ai"],
  videogen: ["network", "ai"],
  "analyze-image": ["network", "ai"],
  "read-doc": ["network", "ai"],
  semanticsearch: ["read-only"],
  task: ["execution"],
  swarm: ["execution"],
  deploy: ["execution", "network"],
  database: ["execution", "filesystem"],
  browser: ["network"],
  git: ["filesystem", "execution"],
  package: ["execution", "network"],
  lsp: ["read-only"],
  canvas: ["network"],
}

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]

    const matches = await Config.directories().then((dirs) =>
      dirs.flatMap((dir) =>
        Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
      ),
    )
    if (matches.length) await Config.waitForDependencies()
    for (const match of matches) {
      const namespace = path.basename(match, path.extname(match))
      const mod = await import(match)
      for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
        custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          const result = await def.execute(args as any, pluginCtx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()
    const question = ["app", "cli", "desktop"].includes(Flag.HOPCODERX_CLIENT) || Flag.HOPCODERX_ENABLE_QUESTION_TOOL

    return [
      InvalidTool,
      ...(question ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      ...(config.experimental?.semantic_search?.enabled !== false ? [SemanticSearchTool] : []),
      ...(config.experimental?.swarm?.enabled ? [SwarmTool] : []),
      VisualDebugTool,
      SkillTool,
      ApplyPatchTool,
      TestgenTool,
      DocgenTool,
      DepauditTool,
      CodeVulnScanTool,
      RecallMemoryTool,
      RememberTool,
      ImageUnderstandingTool,
      DocUnderstandingTool,
      AudioTranscriptionTool,
      ImageGenTool,
      TTSTool,
      VoiceInputTool,
      TavilySearchTool,
      ExaSearchTool,
      FirecrawlTool,
      VideoGenTool,
      AiDebugTool,
      ArchDiagramTool,
      DuckDuckGoSearchTool,
      GitTool,
      HttpTool,
      PackageTool,
      EnvTool,
      ReviewTool,
      ConfigTool,
      DatabaseTool,
      BrowserTool,
      RefactorTool,
      DeployTool,
      CacheTool,
      ComposeTool,
      MultiEditTool,
      CanvasTool,
      McpControlTool,
      ...(Flag.HOPCODERX_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.HOPCODERX_EXPERIMENTAL_PLAN_MODE && Flag.HOPCODERX_CLIENT === "cli" ? [PlanExitTool, PlanEnterTool] : []),
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  /**
   * Return all tools that declare any of the given capability tags.
   * Merges the centralized TOOL_CAPABILITIES map with any capabilities set
   * directly on the Tool.Info object (e.g. by plugin tools).
   */
  export async function byCapability(caps: NonNullable<Tool.Info["capabilities"]>): Promise<Tool.Info[]> {
    if (caps.length === 0) return []
    const tools = await all()
    return tools.filter((t) => {
      const effective = t.capabilities ?? TOOL_CAPABILITIES[t.id] ?? []
      return effective.some((c) => caps.includes(c))
    })
  }

  /**
   * Return per-tool usage metrics collected since process start.
   * Delegates to the Telemetry module.
   */
  export function usageStats() {
    return import("../telemetry/telemetry").then(({ Telemetry }) => Telemetry.metrics().tools)
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
  ) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((t) => {
          // Enable websearch/codesearch for zen users OR via enable flag
          if (t.id === "codesearch" || t.id === "websearch") {
            return model.providerID === "hopcoderx" || Flag.HOPCODERX_ENABLE_EXA
          }

          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          const tool = await t.init({ agent })
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          await Plugin.trigger("tool.definition", { toolID: t.id }, output)
          return {
            id: t.id,
            ...tool,
            description: output.description,
            parameters: output.parameters,
          }
        }),
    )
    return result
  }
}
