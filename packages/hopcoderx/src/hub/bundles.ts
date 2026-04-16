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
    HubManifest.Bundle.parse({
      id: "bundle:code-review",
      kind: "bundle",
      name: "Code Review",
      description: "Static analysis, linting diagnostics, and structured review workflows for code quality work.",
      source: "builtin",
      category: "code-quality",
      tags: ["code-review", "linting", "static-analysis", "quality"],
      author: "HopCoderX",
      recommendedAgent: "reviewer",
      aliases: ["review-code", "lint-review"],
      starterPrompts: [
        "Review this pull request for correctness, clarity, and potential regressions.",
        "Run a full lint and static analysis pass and summarize the actionable findings.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "skill", id: "skill:builtin:github", reason: "GitHub diff and PR context" },
        { kind: "mcp", id: "mcp:github", reason: "Read PR diffs, review comments, and check run results" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Step-by-step reasoning through complex review findings" },
        { kind: "mcp", id: "mcp:memory", reason: "Track findings and reviewer notes across a review session" },
      ],
    }),
    HubManifest.Bundle.parse({
      id: "bundle:cloud-infra",
      kind: "bundle",
      name: "Cloud Infra",
      description: "Infrastructure-as-code, cloud CLI operations, and deployment orchestration stack.",
      source: "builtin",
      category: "infrastructure",
      tags: ["cloud", "terraform", "kubernetes", "deployment", "infra"],
      author: "HopCoderX",
      recommendedAgent: "build",
      aliases: ["infra", "cloud-deploy"],
      starterPrompts: [
        "Inspect the current infrastructure state and surface any configuration drift or security issues.",
        "Propose a safe deployment plan for this change and outline rollback steps.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: true,
      },
      items: [
        { kind: "mcp", id: "mcp:kubernetes", reason: "Cluster state, pod logs, and deployment management" },
        { kind: "mcp", id: "mcp:terraform", reason: "Infra-as-code planning, apply, and drift detection" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Structured deployment and rollback planning" },
        { kind: "mcp", id: "mcp:memory", reason: "Persist deployment context and decisions across operations" },
      ],
    }),
    HubManifest.Bundle.parse({
      id: "bundle:fullstack-dev",
      kind: "bundle",
      name: "Full-Stack Dev",
      description: "Database access, API tooling, and frontend utilities for full-stack development workflows.",
      source: "builtin",
      category: "development",
      tags: ["fullstack", "database", "api", "frontend", "development"],
      author: "HopCoderX",
      recommendedAgent: "build",
      aliases: ["fullstack", "web-dev"],
      starterPrompts: [
        "Audit the database schema and API contracts for inconsistencies or missing validations.",
        "Scaffold a new feature end-to-end: database migration, API handler, and frontend component.",
      ],
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "skill", id: "skill:builtin:tmux", reason: "Run servers, dev tools, and watch processes in parallel" },
        { kind: "mcp", id: "mcp:postgres", reason: "Query and inspect database schemas and records" },
        { kind: "mcp", id: "mcp:npm-mcp", reason: "Manage and inspect frontend and API dependencies" },
        { kind: "mcp", id: "mcp:playwright", reason: "Test and verify UI flows end-to-end" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Step-by-step reasoning for cross-layer feature design" },
      ],
    }),
  ]

  export function get(id: string) {
    return registry.find((bundle) => bundle.id === id || bundle.name === id)
  }

  /** Return the bundle that contains a specific MCP or skill id. */
  export function findByItem(itemId: string): HubManifest.Bundle | undefined {
    return registry.find((bundle) => bundle.items.some((rel) => rel.id === itemId))
  }

  /** Return all bundles that contain any of the given MCP or skill ids. */
  export function findAllByItems(itemIds: string[]): HubManifest.Bundle[] {
    const ids = new Set(itemIds)
    return registry.filter((bundle) => bundle.items.some((rel) => ids.has(rel.id)))
  }
}
