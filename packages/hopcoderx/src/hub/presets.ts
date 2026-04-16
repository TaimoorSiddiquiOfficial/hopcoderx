import { HubManifest } from "./manifest"

export namespace HubPresets {
  export const registry: HubManifest.Preset[] = [
    HubManifest.Preset.parse({
      id: "preset:github-triage",
      kind: "preset",
      name: "GitHub Triage",
      description: "Opinionated onboarding for reviewing issues, pull requests, and repo state with minimal setup friction.",
      source: "builtin",
      category: "vcs",
      tags: ["github", "triage", "issues", "pull-requests"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:github-maintainer", reason: "Base maintainer MCP stack" }],
      onboarding: [
        {
          title: "Install the maintainer bundle",
          description: "Registers GitHub, memory, and sequential-thinking MCPs using auth-aware defaults.",
        },
        {
          title: "Authenticate GitHub MCP",
          description: "Complete OAuth before enabling issue and PR operations.",
          command: "hopcoderx hub auth github",
        },
        {
          title: "Run a health check",
          description: "Verify readiness and spot missing auth or env configuration quickly.",
          command: "hopcoderx hub doctor",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:web-repro",
      kind: "preset",
      name: "Web Repro",
      description: "Fast browser-debug onboarding for reproducing UI bugs and inspecting live pages.",
      source: "builtin",
      category: "browser",
      tags: ["browser", "playwright", "debugging", "devtools"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:web-debug", reason: "Browser debugging MCP stack" }],
      onboarding: [
        {
          title: "Install the browser-debug bundle",
          description: "Registers Playwright, Chrome DevTools, and npm MCPs for reproduction workflows.",
        },
        {
          title: "Confirm browser dependencies",
          description: "Playwright may need browsers or local setup depending on your machine.",
          command: "hopcoderx hub doctor",
        },
        {
          title: "Start a repro session",
          description: "Open HopCoderX and ask it to reproduce the failing flow with Playwright or DevTools.",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:deep-research",
      kind: "preset",
      name: "Deep Research",
      description: "Research-heavy setup for search, memory retention, and explicit reasoning loops.",
      source: "builtin",
      category: "search",
      tags: ["research", "search", "memory", "reasoning"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:research-assistant", reason: "Core research MCP stack" }],
      onboarding: [
        {
          title: "Install the research bundle",
          description: "Registers SearXNG, memory, and sequential-thinking MCPs.",
        },
        {
          title: "Verify search configuration",
          description: "If your search provider needs local env or remote access, doctor will show what is missing.",
          command: "hopcoderx hub doctor",
        },
        {
          title: "Use a planning-first workflow",
          description: "Start sessions with a planning prompt so the agent searches, synthesizes, and tracks findings systematically.",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:spec-driven-planning",
      kind: "preset",
      name: "Spec-Driven Planning",
      description: "Opinionated setup for planning, task decomposition, and review-heavy execution loops.",
      source: "builtin",
      category: "productivity",
      tags: ["planning", "review", "specs", "orchestration"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:planning-orchestrator", reason: "Structured planning and review stack" }],
      onboarding: [
        {
          title: "Install the planning bundle",
          description: "Registers memory, sequential-thinking, and the planning-oriented built-in skills.",
        },
        {
          title: "Review current readiness",
          description: "Check whether GitHub or other optional MCPs in the stack still need authentication.",
          command: "hopcoderx hub doctor",
        },
        {
          title: "Start with a planning prompt",
          description: "Ask the plan agent to decompose the work before implementation and revisit the plan after each milestone.",
        },
      ],
    }),
  ]

  export function get(id: string) {
    return registry.find((preset) => preset.id === id || preset.name === id)
  }
}
