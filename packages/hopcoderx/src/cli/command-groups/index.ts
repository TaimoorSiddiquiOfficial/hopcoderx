import { automationCommandGroup } from "./automation"
import { diagnosticsCommandGroup } from "./diagnostics"
import { integrationsCommandGroup } from "./integrations"
import { servicesCommandGroup } from "./services"
import { sessionCommandGroup } from "./session"
import { setupCommandGroup } from "./setup"

import type { CommandModule } from "yargs"

export type CommandGroup = {
  name: string
  title: string
  summary: string[]
  commands: CommandModule[]
}

export const CommandGroups = [
  sessionCommandGroup,
  setupCommandGroup,
  servicesCommandGroup,
  diagnosticsCommandGroup,
  integrationsCommandGroup,
  automationCommandGroup,
] satisfies CommandGroup[]
