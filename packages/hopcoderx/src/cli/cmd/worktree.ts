import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Worktree } from "../../worktree"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { EOL } from "os"
import { $ } from "bun"

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage git worktrees",
  builder: (yargs: Argv) =>
    yargs
      .command(WorktreeCreateCommand)
      .command(WorktreeListCommand)
      .command(WorktreeDeleteCommand)
      .demandCommand(),
  async handler() {},
})

export const WorktreeCreateCommand = cmd({
  command: "create [name]",
  describe: "create a new worktree",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        describe: "name for the worktree (auto-generated if omitted)",
        type: "string",
      })
      .option("start-command", {
        describe: "additional startup script to run after project start command",
        type: "string",
        alias: "s",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const info = await Worktree.create({
        name: args.name,
        startCommand: args.startCommand,
      })
      UI.println(`Created worktree ${UI.Style.TEXT_SUCCESS_BOLD}${info.name}${UI.Style.TEXT_NORMAL}`)
      UI.println(`  branch:    ${info.branch}`)
      UI.println(`  directory: ${info.directory}`)
    })
  },
})

export const WorktreeListCommand = cmd({
  command: "list",
  describe: "list all worktrees",
  builder: (yargs: Argv) =>
    yargs.option("format", {
      describe: "output format",
      choices: ["table", "json"] as const,
      default: "table" as "table" | "json",
      type: "string",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await $`git worktree list --porcelain`.quiet().nothrow()
      if (result.exitCode !== 0) {
        UI.error("Failed to list worktrees")
        process.exit(1)
      }

      const lines = new TextDecoder().decode(result.stdout).trim().split("\n")
      const worktrees: { path: string; branch: string; head: string }[] = []
      let current: { path?: string; branch?: string; head?: string } = {}

      for (const line of lines) {
        if (!line.trim()) {
          if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)", head: current.head ?? "" })
          current = {}
          continue
        }
        if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length).trim()
        else if (line.startsWith("branch ")) current.branch = line.slice("branch refs/heads/".length).trim()
        else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length, 12 + "HEAD ".length).trim()
      }
      if (current.path) worktrees.push({ path: current.path, branch: current.branch ?? "(detached)", head: current.head ?? "" })

      if (args.format === "json") {
        process.stdout.write(JSON.stringify(worktrees, null, 2) + EOL)
        return
      }

      if (worktrees.length === 0) {
        UI.println("No worktrees found")
        return
      }

      const maxPath = Math.max(...worktrees.map((w) => w.path.length), 4)
      const maxBranch = Math.max(...worktrees.map((w) => w.branch.length), 6)
      UI.println(
        `${"PATH".padEnd(maxPath)}  ${"BRANCH".padEnd(maxBranch)}  HEAD`,
      )
      UI.println(`${"-".repeat(maxPath)}  ${"-".repeat(maxBranch)}  --------`)
      for (const w of worktrees) {
        UI.println(`${w.path.padEnd(maxPath)}  ${w.branch.padEnd(maxBranch)}  ${w.head}`)
      }
    })
  },
})

export const WorktreeDeleteCommand = cmd({
  command: "delete <directory>",
  describe: "delete a worktree",
  builder: (yargs: Argv) =>
    yargs.positional("directory", {
      describe: "directory of the worktree to delete",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      await Worktree.remove({ directory: args.directory })
      UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}Deleted worktree${UI.Style.TEXT_NORMAL} at ${args.directory}`)
    })
  },
})
