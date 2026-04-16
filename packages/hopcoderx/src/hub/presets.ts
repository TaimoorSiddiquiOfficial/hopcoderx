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
    HubManifest.Preset.parse({
      id: "preset:code-review",
      kind: "preset",
      name: "Code Review",
      description: "Opinionated setup for structured pull request review and static analysis workflows.",
      source: "builtin",
      category: "code-quality",
      tags: ["code-review", "pull-request", "static-analysis"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:code-review", reason: "Core review MCP and skill stack" }],
      onboarding: [
        {
          title: "Install the code-review bundle",
          description: "Registers GitHub, memory, and sequential-thinking MCPs for review workflows.",
        },
        {
          title: "Authenticate GitHub MCP",
          description: "OAuth is required to read PR diffs, comments, and check runs.",
          command: "hopcoderx hub auth github",
        },
        {
          title: "Verify readiness",
          description: "Confirm all review MCPs are connected and GitHub auth is active.",
          command: "hopcoderx hub doctor",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:cloud-infra",
      kind: "preset",
      name: "Cloud Infra",
      description: "Guided onboarding for cloud operations, Kubernetes cluster management, and Terraform workflows.",
      source: "builtin",
      category: "infrastructure",
      tags: ["cloud", "kubernetes", "terraform", "deployment"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:cloud-infra", reason: "Infrastructure MCP stack" }],
      onboarding: [
        {
          title: "Install the cloud-infra bundle",
          description: "Registers Kubernetes, Terraform, memory, and sequential-thinking MCPs.",
        },
        {
          title: "Set cluster credentials",
          description: "Ensure your kubeconfig and cloud provider credentials are exported before connecting.",
          envKeys: ["KUBECONFIG"],
        },
        {
          title: "Check infra MCP readiness",
          description: "Doctor will identify missing env vars or auth for cloud provider MCPs.",
          command: "hopcoderx hub doctor",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:fullstack-dev",
      kind: "preset",
      name: "Full-Stack Dev",
      description: "Database, API, and frontend tooling preset for end-to-end development workflows.",
      source: "builtin",
      category: "development",
      tags: ["fullstack", "database", "api", "playwright"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:fullstack-dev", reason: "Full-stack development MCP stack" }],
      onboarding: [
        {
          title: "Install the fullstack-dev bundle",
          description: "Registers Postgres, npm, Playwright, and sequential-thinking MCPs.",
        },
        {
          title: "Configure database connection",
          description: "Postgres MCP requires a connection string env var to access your database.",
          envKeys: ["DATABASE_URL"],
        },
        {
          title: "Verify readiness",
          description: "Run doctor to confirm database and browser MCPs are connected.",
          command: "hopcoderx hub doctor",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:data-analysis",
      kind: "preset",
      name: "Data Analysis",
      description: "Setup for SQL-driven data exploration with database connections and analytical reasoning.",
      source: "builtin",
      category: "data",
      tags: ["data", "sql", "analytics", "duckdb"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:data-analysis", reason: "Core data analysis MCP stack" }],
      onboarding: [
        {
          title: "Install the data-analysis bundle",
          description: "Registers Postgres, SQLite, memory, and sequential-thinking MCPs.",
        },
        {
          title: "Configure database connection",
          description: "Postgres MCP needs a connection string; SQLite MCP needs a file path to your database.",
          envKeys: ["DATABASE_URL"],
        },
        {
          title: "Verify readiness",
          description: "Run doctor to confirm database MCPs are reachable.",
          command: "hopcoderx hub doctor",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:security-audit",
      kind: "preset",
      name: "Security Audit",
      description: "Guided setup for dependency scanning, secret detection, and vulnerability analysis workflows.",
      source: "builtin",
      category: "security",
      tags: ["security", "audit", "cve", "secrets"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:security-audit", reason: "Security audit MCP and skill stack" }],
      onboarding: [
        {
          title: "Install the security-audit bundle",
          description: "Registers GitHub, memory, and sequential-thinking MCPs for audit workflows.",
        },
        {
          title: "Authenticate GitHub MCP",
          description: "GitHub auth enables access to security advisories, code scanning alerts, and dependency graphs.",
          command: "hopcoderx hub auth github",
        },
        {
          title: "Start an audit session",
          description: "Ask the reviewer agent to scan the codebase for vulnerabilities, secrets, or dependency CVEs.",
        },
      ],
    }),
    HubManifest.Preset.parse({
      id: "preset:design-to-code",
      kind: "preset",
      name: "Design to Code",
      description: "Figma handoff and browser verification setup for design-to-component implementation workflows.",
      source: "builtin",
      category: "design",
      tags: ["design", "figma", "components", "ui"],
      author: "HopCoderX",
      appliesTo: [{ kind: "bundle", id: "bundle:design-to-code", reason: "Design-to-implementation MCP stack" }],
      onboarding: [
        {
          title: "Install the design-to-code bundle",
          description: "Registers Figma, Playwright, npm, and sequential-thinking MCPs.",
        },
        {
          title: "Configure Figma access token",
          description: "Figma MCP requires a personal access token to read design files and component specs.",
          envKeys: ["FIGMA_API_KEY"],
        },
        {
          title: "Verify browser and Figma readiness",
          description: "Run doctor to confirm Figma auth and Playwright browsers are available.",
          command: "hopcoderx hub doctor",
        },
      ],
    }),
  ]

  export function get(id: string) {
    return registry.find((preset) => preset.id === id || preset.name === id)
  }
}
