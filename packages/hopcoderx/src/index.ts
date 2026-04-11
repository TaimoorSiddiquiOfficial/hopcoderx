import { buildCommandOverview, registerCommands } from "./cli/command-registry"
import { createCli, handleFatal, isTopLevelHelpRequest, registerProcessHandlers, renderTopLevelHelp } from "./cli/entrypoint"

registerProcessHandlers()

const cli = createCli()

registerCommands(cli)
cli.epilogue(buildCommandOverview())

try {
  if (isTopLevelHelpRequest()) {
    process.stdout.write(await renderTopLevelHelp(cli))
    process.exit(0)
  }
  await cli.parse()
} catch (e) {
  handleFatal(e)
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
