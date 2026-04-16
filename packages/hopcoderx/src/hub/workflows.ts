import { z } from "zod"
import { HubManifest } from "./manifest"
import { HubBundles } from "./bundles"
import { HubPresets } from "./presets"

export namespace HubWorkflows {
  export const Workflow = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    presetID: z.string(),
    aliases: z.array(z.string()).default([]),
    recommendedAgent: z.string().optional(),
    starterPrompt: z.string().optional(),
  })
  export type Workflow = z.infer<typeof Workflow>

  export const ResolvedWorkflow = Workflow.extend({
    preset: HubManifest.Preset.optional(),
  })
  export type ResolvedWorkflow = z.infer<typeof ResolvedWorkflow>

  export const registry: Workflow[] = [
    Workflow.parse({
      id: "workflow:triage",
      name: "triage",
      description: "Install the GitHub maintainer stack and jump into issue/PR review quickly.",
      presetID: "preset:github-triage",
      aliases: ["gh-triage", "review-prs"],
      recommendedAgent: HubBundles.get("bundle:github-maintainer")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:github-maintainer")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:repro",
      name: "repro",
      description: "Set up the browser-debug stack for fast web reproduction and investigation.",
      presetID: "preset:web-repro",
      aliases: ["debug-web", "web-repro"],
      recommendedAgent: HubBundles.get("bundle:web-debug")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:web-debug")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:research",
      name: "research",
      description: "Enable the research stack and start with a deep-search workflow.",
      presetID: "preset:deep-research",
      aliases: ["deep-dive", "investigate"],
      recommendedAgent: HubBundles.get("bundle:research-assistant")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:research-assistant")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:plan",
      name: "plan",
      description: "Install the planning stack and start with a spec-driven review and execution loop.",
      presetID: "preset:spec-driven-planning",
      aliases: ["spec-plan", "review-plan"],
      recommendedAgent: HubBundles.get("bundle:planning-orchestrator")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:planning-orchestrator")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:code-review",
      name: "code-review",
      description: "Install the code-review stack and start structured PR analysis and static analysis workflows.",
      presetID: "preset:code-review",
      aliases: ["review", "pr-review"],
      recommendedAgent: HubBundles.get("bundle:code-review")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:code-review")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:cloud-infra",
      name: "cloud-infra",
      description: "Set up the cloud infrastructure stack for Kubernetes management and Terraform workflows.",
      presetID: "preset:cloud-infra",
      aliases: ["infra", "deploy"],
      recommendedAgent: HubBundles.get("bundle:cloud-infra")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:cloud-infra")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:fullstack",
      name: "fullstack",
      description: "Configure the full-stack development environment for database, API, and UI workflows.",
      presetID: "preset:fullstack-dev",
      aliases: ["fullstack-dev", "web-dev"],
      recommendedAgent: HubBundles.get("bundle:fullstack-dev")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:fullstack-dev")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:data",
      name: "data",
      description: "Set up the data analysis stack for SQL-driven exploration and analytical reasoning workflows.",
      presetID: "preset:data-analysis",
      aliases: ["data-analysis", "analytics"],
      recommendedAgent: HubBundles.get("bundle:data-analysis")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:data-analysis")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:security",
      name: "security",
      description: "Enable the security audit stack for dependency scanning, secret detection, and vulnerability analysis.",
      presetID: "preset:security-audit",
      aliases: ["security-audit", "vuln-scan"],
      recommendedAgent: HubBundles.get("bundle:security-audit")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:security-audit")?.starterPrompts[0],
    }),
    Workflow.parse({
      id: "workflow:design",
      name: "design",
      description: "Install the design-to-code stack for Figma handoff and browser-verified component implementation.",
      presetID: "preset:design-to-code",
      aliases: ["design-to-code", "figma"],
      recommendedAgent: HubBundles.get("bundle:design-to-code")?.recommendedAgent,
      starterPrompt: HubBundles.get("bundle:design-to-code")?.starterPrompts[0],
    }),
  ]

  export function list(query?: string) {
    if (!query) return registry
    const needle = query.toLowerCase()
    return registry.filter(
      (item) =>
        item.id.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(needle)),
    )
  }

  export function get(id: string) {
    return registry.find((item) => item.id === id || item.name === id || item.aliases.includes(id))
  }

  export function presetFor(workflow: Workflow) {
    return HubPresets.get(workflow.presetID)
  }

  export function resolve(workflow: Workflow): ResolvedWorkflow {
    return {
      ...workflow,
      preset: presetFor(workflow),
    }
  }

  export function listResolved(query?: string): ResolvedWorkflow[] {
    return list(query).map(resolve)
  }

  export function getResolved(id: string): ResolvedWorkflow | undefined {
    const workflow = get(id)
    if (!workflow) return undefined
    return resolve(workflow)
  }
}
