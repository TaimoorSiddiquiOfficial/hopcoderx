import { McpCommand } from "../cmd/mcp"
import { GithubCommand } from "../cmd/github"
import { PrCommand } from "../cmd/pr"
import { TailscaleCommand } from "../cmd/tailscale"
import { PairCommand } from "../cmd/pair"
import { HubCommand } from "../cmd/hub"
import { PersonaCommand } from "../cmd/persona"
import { integrationsTaxonomy } from "../command-taxonomy"

export const integrationsCommandGroup = {
  ...integrationsTaxonomy,
  commands: [McpCommand, GithubCommand, PrCommand, TailscaleCommand, PairCommand, HubCommand, PersonaCommand],
}
