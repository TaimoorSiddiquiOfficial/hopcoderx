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
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
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
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
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
      activation: {
        defaultEnabled: false,
        autoDisableWhenMissing: false,
        requiresSetup: false,
      },
      items: [
        { kind: "mcp", id: "mcp:searxng", reason: "Web and document discovery" },
        { kind: "mcp", id: "mcp:memory", reason: "Retain findings across sessions" },
        { kind: "mcp", id: "mcp:sequential-thinking", reason: "Turn findings into explicit reasoning steps" },
      ],
    }),
  ]

  export function get(id: string) {
    return registry.find((bundle) => bundle.id === id || bundle.name === id)
  }
}
