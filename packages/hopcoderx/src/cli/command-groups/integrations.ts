import { McpCommand } from "../cmd/mcp"
import { GithubCommand } from "../cmd/github"
import { PrCommand } from "../cmd/pr"
import { TailscaleCommand } from "../cmd/tailscale"
import { PairCommand } from "../cmd/pair"
import { HubCommand } from "../cmd/hub"
import { PersonaCommand } from "../cmd/persona"

export const integrationsCommandGroup = {
  name: "integrations",
  title: "Integrations",
  summary: ["mcp", "github", "pr", "tailscale", "pair", "hub", "persona"],
  commands: [McpCommand, GithubCommand, PrCommand, TailscaleCommand, PairCommand, HubCommand, PersonaCommand],
}
