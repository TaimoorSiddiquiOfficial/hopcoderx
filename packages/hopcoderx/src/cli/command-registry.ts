import type yargs from "yargs"
import { CommandGroups } from "./command-groups"

type Cli = ReturnType<typeof yargs>

export function registerCommands(cli: Cli) {
  for (const group of CommandGroups) {
    for (const command of group.commands) {
      cli.command(command as never)
    }
  }
  return cli
}

export function buildCommandOverview() {
  return [
    "",
    "Command groups:",
    ...CommandGroups.flatMap((group) => [`  ${group.title}`, `    ${group.summary.join(", ")}`]),
  ].join("\n")
}
