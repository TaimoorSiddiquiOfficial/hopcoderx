import { z } from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { HubCatalog } from "./catalog"
import { HubWorkflows } from "./workflows"

export namespace HubEcosystem {
  export const Section = z.enum(["official", "community"])
  export type Section = z.infer<typeof Section>

  export const Kind = z.enum(["plugin", "agent", "theme", "skill", "resource", "project", "sdk"])
  export type Kind = z.infer<typeof Kind>

  export const Entry = z.object({
    id: z.string(),
    section: Section,
    kind: Kind,
    name: z.string(),
    description: z.string(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    tags: z.array(z.string()).default([]),
    hubRefs: z.array(z.string()).default([]),
  })
  export type Entry = z.infer<typeof Entry>

  export const Link = z.object({
    id: z.string(),
    kind: z.enum(["mcp", "skill", "bundle", "preset", "workflow", "unknown"]),
    name: z.string(),
    description: z.string(),
  })
  export type Link = z.infer<typeof Link>

  export const ResolvedEntry = Entry.extend({
    links: z.array(Link),
  })
  export type ResolvedEntry = z.infer<typeof ResolvedEntry>

  export const registry: Entry[] = [
    {
      id: "official:hopcoderx",
      section: "official",
      kind: "project",
      name: "HopCoderX",
      description: "The main HopCoderX terminal agent and TUI/CLI runtime.",
      repository: "https://github.com/TaimoorSiddiquiOfficial/hopcoderx",
      homepage: "https://github.com/TaimoorSiddiquiOfficial/hopcoderx",
      tags: ["official", "core", "terminal-agent"],
      hubRefs: ["bundle:github-maintainer", "bundle:web-debug", "bundle:research-assistant", "bundle:planning-orchestrator", "workflow:plan"],
    },
    {
      id: "official:hub-presets",
      section: "official",
      kind: "resource",
      name: "HopHub Presets",
      description: "Built-in workflow presets for onboarding and guided setup across common developer workflows.",
      tags: ["official", "preset", "workflow"],
      hubRefs: ["preset:github-triage", "preset:web-repro", "preset:deep-research", "preset:spec-driven-planning"],
    },
    {
      id: "community:awesome-opencode",
      section: "community",
      kind: "resource",
      name: "Awesome Opencode",
      description: "Curated ecosystem list of plugins, themes, agents, projects, and resources for terminal coding agents.",
      repository: "https://github.com/awesome-opencode/awesome-opencode",
      homepage: "https://github.com/awesome-opencode/awesome-opencode",
      tags: ["community", "index", "plugins", "agents"],
      hubRefs: [],
    },
    {
      id: "community:oh-my-openagent",
      section: "community",
      kind: "project",
      name: "oh-my-openagent",
      description: "Opinionated workflow packaging reference for presets, orchestrators, aliases, and install-first UX.",
      repository: "https://github.com/code-yeongyu/oh-my-openagent",
      homepage: "https://github.com/code-yeongyu/oh-my-openagent",
      tags: ["community", "workflow", "preset", "agent"],
      hubRefs: [],
    },
    {
      id: "community:mcpmarket",
      section: "community",
      kind: "resource",
      name: "MCP Market",
      description: "Reference marketplace UX for browsing servers separately from tools and skills.",
      homepage: "https://mcpmarket.com",
      tags: ["community", "marketplace", "mcp", "ux"],
      hubRefs: [],
    },
    {
      id: "community:opencode-notifier",
      section: "community",
      kind: "plugin",
      name: "opencode-notifier",
      description: "Notification plugin for permission prompts, completion events, errors, and question-tool interactions.",
      repository: "https://github.com/mohak34/opencode-notifier",
      homepage: "https://github.com/mohak34/opencode-notifier",
      tags: ["community", "plugin", "notifications", "desktop"],
      hubRefs: ["workflow:plan"],
    },
    {
      id: "community:opencode-planning-toolkit",
      section: "community",
      kind: "plugin",
      name: "opencode-planning-toolkit",
      description: "Plan/spec workflow toolkit with structured planning tools and a bundled planning skill.",
      repository: "https://github.com/IgorWarzocha/opencode-planning-toolkit",
      homepage: "https://github.com/IgorWarzocha/opencode-planning-toolkit",
      tags: ["community", "plugin", "planning", "specs"],
      hubRefs: ["bundle:planning-orchestrator", "preset:spec-driven-planning", "workflow:plan"],
    },
    {
      id: "community:opencode-pilot",
      section: "community",
      kind: "project",
      name: "opencode-pilot",
      description: "Automation daemon that polls work sources and spawns sessions from issue or ticket queues.",
      repository: "https://github.com/athal7/opencode-pilot",
      homepage: "https://github.com/athal7/opencode-pilot",
      tags: ["community", "automation", "daemon", "sessions"],
      hubRefs: ["workflow:triage", "workflow:plan"],
    },
    {
      id: "community:plannotator",
      section: "community",
      kind: "resource",
      name: "plannotator",
      description: "Visual plan and diff review system for coding agents with annotation and collaboration flows.",
      repository: "https://github.com/backnotprop/plannotator",
      homepage: "https://github.com/backnotprop/plannotator",
      tags: ["community", "planning", "review", "annotations"],
      hubRefs: ["bundle:planning-orchestrator", "workflow:plan"],
    },
    {
      id: "community:plugin-template",
      section: "community",
      kind: "resource",
      name: "OpenCode Plugin Template",
      description: "Template generator for bootstrapping plugins with TypeScript, CI, tests, and release scaffolding.",
      repository: "https://github.com/zenobi-us/opencode-plugin-template",
      homepage: "https://github.com/zenobi-us/opencode-plugin-template",
      tags: ["community", "template", "plugin", "scaffolding"],
      hubRefs: [],
    },
    {
      id: "community:shell-strategy",
      section: "community",
      kind: "resource",
      name: "opencode-shell-strategy",
      description: "Non-interactive shell command guidance for safer automation and fewer hung sessions.",
      repository: "https://github.com/JRedeker/opencode-shell-strategy",
      homepage: "https://github.com/JRedeker/opencode-shell-strategy",
      tags: ["community", "shell", "non-interactive", "safety"],
      hubRefs: ["workflow:plan"],
    },
    {
      id: "community:unmoji",
      section: "community",
      kind: "plugin",
      name: "opencode-unmoji",
      description: "Plugin that strips or replaces emojis in agent output and markdown file edits.",
      repository: "https://codeberg.org/bastiangx/opencode-unmoji",
      homepage: "https://codeberg.org/bastiangx/opencode-unmoji",
      tags: ["community", "plugin", "output", "markdown"],
      hubRefs: [],
    },
    {
      id: "community:open-ralph-wiggum",
      section: "community",
      kind: "project",
      name: "Open Ralph Wiggum",
      description: "Autonomous iterative loop wrapper for coding agents that repeats a prompt until the task is complete.",
      repository: "https://github.com/Th0rgal/open-ralph-wiggum",
      homepage: "https://github.com/Th0rgal/open-ralph-wiggum",
      tags: ["community", "automation", "loop", "agents"],
      hubRefs: ["workflow:plan", "workflow:triage"],
    },
    {
      id: "community:opencode-snip",
      section: "community",
      kind: "plugin",
      name: "opencode-snip",
      description: "Shell-output compression plugin that prefixes commands with snip to reduce token usage.",
      repository: "https://github.com/VincentHardouin/opencode-snip",
      homepage: "https://github.com/VincentHardouin/opencode-snip",
      tags: ["community", "plugin", "shell", "tokens"],
      hubRefs: ["workflow:plan"],
    },
    {
      id: "community:opencode-mem",
      section: "community",
      kind: "plugin",
      name: "opencode-mem",
      description: "Persistent memory plugin with local vector storage, project timelines, and long-term context retention.",
      repository: "https://github.com/tickernelz/opencode-mem",
      homepage: "https://github.com/tickernelz/opencode-mem",
      tags: ["community", "plugin", "memory", "vector-db"],
      hubRefs: ["bundle:research-assistant", "bundle:planning-orchestrator", "workflow:research", "workflow:plan"],
    },
    {
      id: "community:envsitter-guard",
      section: "community",
      kind: "plugin",
      name: "envsitter-guard",
      description: "Sensitive `.env*` protection plugin with safe inspection and mutation tools that never reveal secret values.",
      repository: "https://github.com/boxpositron/envsitter-guard",
      homepage: "https://github.com/boxpositron/envsitter-guard",
      tags: ["community", "plugin", "security", "env"],
      hubRefs: ["workflow:plan"],
    },
    {
      id: "community:opencode-agent-skills",
      section: "community",
      kind: "plugin",
      name: "opencode-agent-skills",
      description: "Dynamic skill-loading plugin with project/user discovery, context injection, and compaction-resilient reusable skills.",
      repository: "https://github.com/joshuadavidthomas/opencode-agent-skills",
      homepage: "https://github.com/joshuadavidthomas/opencode-agent-skills",
      tags: ["community", "plugin", "skills", "context"],
      hubRefs: ["bundle:planning-orchestrator", "workflow:plan"],
    },
    {
      id: "community:antigravity-multi-auth",
      section: "community",
      kind: "plugin",
      name: "opencode-antigravity-multi-auth",
      description: "OAuth plugin for Antigravity with multi-account rotation and Google-backed model access.",
      repository: "https://github.com/theblazehen/opencode-antigravity-multi-auth",
      homepage: "https://github.com/theblazehen/opencode-antigravity-multi-auth",
      tags: ["community", "plugin", "auth", "providers"],
      hubRefs: ["workflow:research", "workflow:plan"],
    },
    {
      id: "community:opentmux",
      section: "community",
      kind: "plugin",
      name: "opentmux",
      description: "Smart tmux integration plugin for real-time agent panes, live streaming, and terminal workspace orchestration.",
      repository: "https://github.com/AnganSamadder/opentmux",
      homepage: "https://github.com/AnganSamadder/opentmux",
      tags: ["community", "plugin", "tmux", "terminal"],
      hubRefs: ["bundle:web-debug", "bundle:planning-orchestrator", "workflow:repro", "workflow:plan"],
    },
  ]

  export function list(input?: {
    section?: Section
    kind?: Kind
    query?: string
  }) {
    let items = registry
    if (input?.section) items = items.filter((item) => item.section === input.section)
    if (input?.kind) items = items.filter((item) => item.kind === input.kind)
    if (input?.query) {
      const query = input.query.toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
    }
    return items
  }

  export function get(id: string) {
    return registry.find((item) => item.id === id || item.name === id)
  }

  async function resolveLink(
    id: string,
    input: {
      configMcp?: NonNullable<Config.Info["mcp"]>
      mcpRuntime?: Record<string, MCP.Status>
    } = {},
  ): Promise<Link> {
    const workflow = HubWorkflows.get(id)
    if (workflow) {
      return {
        id: workflow.id,
        kind: "workflow",
        name: workflow.name,
        description: workflow.description,
      }
    }

    const item = await HubCatalog.get(id, {
      configMcp: input.configMcp,
      mcpRuntime: input.mcpRuntime,
      view: "all",
    })
    if (item) {
      return {
        id: item.manifest.id,
        kind: item.manifest.kind,
        name: item.manifest.name,
        description: item.manifest.description,
      }
    }

    return {
      id,
      kind: "unknown",
      name: id,
      description: "Referenced Hub item could not be resolved.",
    }
  }

  export async function listResolved(
    input?: {
      section?: Section
      kind?: Kind
      query?: string
      configMcp?: NonNullable<Config.Info["mcp"]>
      mcpRuntime?: Record<string, MCP.Status>
    },
  ): Promise<ResolvedEntry[]> {
    const items = list(input)
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        links: await Promise.all(
          item.hubRefs.map((id) =>
            resolveLink(id, {
              configMcp: input?.configMcp,
              mcpRuntime: input?.mcpRuntime,
            }),
          ),
        ),
      })),
    )
  }

  export async function getResolved(
    id: string,
    input: {
      configMcp?: NonNullable<Config.Info["mcp"]>
      mcpRuntime?: Record<string, MCP.Status>
    } = {},
  ): Promise<ResolvedEntry | undefined> {
    const item = get(id)
    if (!item) return undefined
    return {
      ...item,
      links: await Promise.all(
        item.hubRefs.map((ref) =>
          resolveLink(ref, {
            configMcp: input.configMcp,
            mcpRuntime: input.mcpRuntime,
          }),
        ),
      ),
    }
  }
}
