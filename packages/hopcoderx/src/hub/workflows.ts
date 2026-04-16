import { z } from "zod"
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
}
