type TaxonomyGroup = {
  name: string
  title: string
  summary: string[]
  completion: string[]
}

export const sessionTaxonomy: TaxonomyGroup = {
  name: "session",
  title: "Session & TUI",
  summary: ["[project]", "attach", "run", "session", "replay", "acp", "repl"],
  completion: ["acp", "attach", "run", "session", "replay", "repl"],
}

export const setupTaxonomy: TaxonomyGroup = {
  name: "setup",
  title: "Setup & install",
  summary: ["onboard", "auth", "models", "upgrade", "repair", "uninstall", "whoami", "init", "new"],
  completion: ["onboard", "auth", "models", "upgrade", "repair", "uninstall", "whoami", "init", "new"],
}

export const servicesTaxonomy: TaxonomyGroup = {
  name: "services",
  title: "Services & daemons",
  summary: ["serve", "daemon", "web", "channels", "hooks", "webhooks", "cron"],
  completion: ["serve", "daemon", "web", "channels", "hooks", "webhooks", "cron"],
}

export const diagnosticsTaxonomy: TaxonomyGroup = {
  name: "diagnostics",
  title: "Diagnostics & maintenance",
  summary: ["doctor", "status", "debug", "stats", "db", "completion", "config", "palette", "trace", "replay"],
  completion: ["doctor", "status", "debug", "stats", "db", "completion", "config", "palette", "trace", "replay"],
}

export const integrationsTaxonomy: TaxonomyGroup = {
  name: "integrations",
  title: "Integrations",
  summary: ["mcp", "github", "pr", "tailscale", "pair", "hub", "persona"],
  completion: ["mcp", "github", "pr", "tailscale", "pair", "hub", "persona"],
}

export const automationTaxonomy: TaxonomyGroup = {
  name: "automation",
  title: "Automation & workflows",
  summary: [
    "generate",
    "agent",
    "export",
    "import",
    "secrets",
    "security",
    "analytics",
    "memory",
    "sandbox",
    "taskflow",
    "worktree",
    "prompts",
    "cost",
    "sbom",
    "diff",
    "permission",
    "feedback",
    "telemetry",
    "plugins",
    "macro",
  ],
  completion: [
    "generate",
    "agent",
    "export",
    "import",
    "secrets",
    "security",
    "analytics",
    "memory",
    "sandbox",
    "accessibility",
    "a11y",
    "taskflow",
    "worktree",
    "prompts",
    "cost",
    "sbom",
    "diff",
    "permission",
    "feedback",
    "telemetry",
    "plugins",
    "plug",
    "macro",
  ],
}

export const CommandTaxonomy = [
  sessionTaxonomy,
  setupTaxonomy,
  servicesTaxonomy,
  diagnosticsTaxonomy,
  integrationsTaxonomy,
  automationTaxonomy,
]

export const TopLevelCompletionCommands = Array.from(new Set(CommandTaxonomy.flatMap((group) => group.completion)))
