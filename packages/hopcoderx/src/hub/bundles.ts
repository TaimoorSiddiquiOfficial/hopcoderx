import { HubManifest } from "./manifest"

export namespace HubBundles {
  export const registry: HubManifest.Bundle[] = [
    HubManifest.Bundle.parse({
      id: "bundle:github-maintainer",
      kind: "bundle",
      name: "GitHub Maintainer",
      description: "A focused maintainer stack for issues, PRs, memory, and deliberate reasoning.",
      source: "builtin",
      category: "vcs",
      tags: ["github", "issues", "pull-requests", "review"],
      author: "HopCoderX",
      recommendedAgent: "reviewer",
      aliases: ["triage", "review-prs"],
      starterPrompts: [
        "Review the newest open pull requests and summarize the highest-risk changes.",
        "Triage open issues and group them by severity, repro quality, and likely owner.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "skill", id: "skill:builtin:github", reason: "GitHub-specific skill shortcuts and guidance" },
        { kind: "skill", id: "skill:builtin:gh-issues", reason: "Issue-focused workflow helpers" },
        { kind: "mcp", id: "mcp:github", reason: "GitHub issues, PRs, and repository operations" },
        { kind: "mcp", id: "mcp:memory", reason: "Carry context across longer maintainer workflows" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Structured investigation and planning" },
      ],
    }),
    HubManifest.Bundle.parse({
      id: "bundle:web-debug",
      kind: "bundle",
      name: "Web Debug",
      description: "Browser automation and debugging tools for reproducing and fixing web issues.",
      source: "builtin",
      category: "browser",
      tags: ["browser", "debugging", "playwright", "devtools"],
      author: "HopCoderX",
      recommendedAgent: "build",
      aliases: ["repro", "debug-web"],
      starterPrompts: [
        "Reproduce the reported browser bug and identify the failing interaction path.",
        "Use browser automation to capture the exact DOM and console state at the point of failure.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "skill", id: "skill:builtin:tmux", reason: "Interactive terminal sessions for repro and debugging" },
        { kind: "mcp", id: "mcp:playwright", reason: "Automated browser control and page inspection" },
        { kind: "mcp", id: "mcp:chrome-devtools", reason: "Deep browser runtime and DOM debugging" },
        { kind: "mcp", id: "mcp:npm-mcp", reason: "Install or inspect frontend dependencies as needed" },
      ],
    }),
    HubManifest.Bundle.parse({
      id: "bundle:research-assistant",
      kind: "bundle",
      name: "Research Assistant",
      description: "Search, memory, and stepwise reasoning for research-heavy agent workflows.",
      source: "builtin",
      category: "search",
      tags: ["research", "search", "memory", "reasoning"],
      author: "HopCoderX",
      recommendedAgent: "explore",
      aliases: ["research", "deep-dive"],
      starterPrompts: [
        "Research this topic deeply, keep a running memory of findings, and return a structured summary.",
        "Search broadly, compare sources, and identify the strongest evidence and open questions.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "skill", id: "skill:builtin:summarize", reason: "Summarization helpers for consolidating findings" },
        { kind: "mcp", id: "mcp:searxng", reason: "Web and document discovery" },
        { kind: "mcp", id: "mcp:memory", reason: "Retain findings across sessions" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Turn findings into explicit reasoning steps" },
      ],
    }),
    HubManifest.Bundle.parse({
      id: "bundle:planning-orchestrator",
      kind: "bundle",
      name: "Planning Orchestrator",
      description: "Spec-driven planning, review loops, and task routing for structured long-running work.",
      source: "builtin",
      category: "productivity",
      tags: ["planning", "review", "orchestration", "tasks"],
      author: "HopCoderX",
      recommendedAgent: "plan",
      aliases: ["plan", "spec-review"],
      starterPrompts: [
        "Break this project into an implementation plan with explicit milestones, risks, and next actions.",
        "Review the current plan, identify gaps, and tighten it before implementation starts.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "skill", id: "skill:builtin:taskflow", reason: "Structured planning and execution checklists" },
        { kind: "skill", id: "skill:builtin:taskflow-inbox-triage", reason: "Triage incoming work into clear execution tracks" },
        { kind: "skill", id: "skill:builtin:summarize", reason: "Condense long plans and review outcomes" },
        { kind: "mcp", id: "mcp:memory", reason: "Persist plan context and decisions across sessions" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Explicit stepwise reasoning for planning and review" },
        { kind: "mcp", id: "mcp:github", reason: "Pull issue and PR context into planning workflows when needed" },
      ],
    }),
  ]

  export function get(id: string) {
    return registry.find((bundle) => bundle.id === id || bundle.name === id)
  }
}
