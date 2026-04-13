import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Worktree } from "../../worktree"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { EOL } from "os"
import { $ } from "bun"

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage git worktrees for parallel agent sessions",
  builder: (yargs: Argv) =>
    yargs
      .command(WorktreeCreateCommand)
      .command(WorktreeListCommand)
      .command(WorktreeDeleteCommand)
      .command(WorktreeSwitchCommand)
      .command(WorktreeDiffCommand)
      .command(WorktreePruneCommand)
      .command(WorktreeRenameCommand)
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
    yargs
      .positional("directory", {
        describe: "directory of the worktree to delete",
        type: "string",
        demandOption: true,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "preview changes without applying",
        default: false,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      if (args.dryRun) {
        UI.println(`${UI.Style.TEXT_INFO}[dry-run] Would delete worktree at ${args.directory}${UI.Style.TEXT_NORMAL}`)
        return
      }
      await Worktree.remove({ directory: args.directory })
      UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}Deleted worktree${UI.Style.TEXT_NORMAL} at ${args.directory}`)
    })
  },
})

export const WorktreeSwitchCommand = cmd({
  command: "switch <directory>",
  describe: "print the cd command to switch into a worktree",
  builder: (yargs: Argv) =>
    yargs.positional("directory", {
      describe: "worktree directory to switch into",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await $`git worktree list --porcelain`.quiet().nothrow()
      if (result.exitCode !== 0) {
        UI.error("Failed to list worktrees")
        process.exit(1)
      }
      const text = new TextDecoder().decode(result.stdout)
      const paths = text
        .split("\n")
        .filter((l) => l.startsWith("worktree "))
        .map((l) => l.slice("worktree ".length).trim())

      const target = paths.find(
        (p) => p === args.directory || p.endsWith("/" + args.directory) || p.endsWith("\\" + args.directory),
      )
      if (!target) {
        UI.error(`Worktree '${args.directory}' not found. Run 'hopcoderx worktree list' to see available worktrees.`)
        process.exit(1)
      }
      UI.println(`To switch to this worktree, run:`)
      UI.println(`  cd ${target}`)
      UI.println(`  hopcoderx run`)
    })
  },
})

export const WorktreeDiffCommand = cmd({
  command: "diff [a] [b]",
  describe: "show diff between two worktrees (or all vs main)",
  builder: (yargs: Argv) =>
    yargs
      .positional("a", { type: "string", describe: "First branch or HEAD ref" })
      .positional("b", { type: "string", describe: "Second branch or HEAD ref" })
      .option("stat", { type: "boolean", describe: "Show stat summary only", default: true }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      if (args.a && args.b) {
        const rangeFlag = `${args.a}...${args.b}`
        const statCmd = args.stat
          ? await $`git diff --stat ${rangeFlag}`.quiet().nothrow()
          : await $`git diff ${rangeFlag}`.quiet().nothrow()
        UI.println(new TextDecoder().decode(statCmd.stdout) || "No differences")
        return
      }

      // Compare all non-main worktrees vs main HEAD
      const result = await $`git worktree list --porcelain`.quiet().nothrow()
      const lines = new TextDecoder().decode(result.stdout).split("\n")
      const worktrees: { path: string; head: string; branch: string }[] = []
      let cur: { path?: string; head?: string; branch?: string } = {}
      for (const l of lines) {
        if (l.startsWith("worktree ")) { if (cur.path) worktrees.push(cur as any); cur = { path: l.slice(9).trim() } }
        else if (l.startsWith("HEAD ")) cur.head = l.slice(5).trim()
        else if (l.startsWith("branch ")) cur.branch = l.slice(15).trim()
      }
      if (cur.path) worktrees.push(cur as any)

      if (worktrees.length < 2) { UI.println("Only one worktree — nothing to diff."); return }
      const main = worktrees[0]
      UI.println(`Comparing worktrees vs ${main.branch ?? "main"} (${(main.head ?? "").slice(0, 8)})\n`)
      for (const wt of worktrees.slice(1)) {
        const label = wt.branch ?? (wt.head ?? "").slice(0, 8)
        UI.println(`─── ${label} ───`)
        const d = await $`git diff --stat ${main.head}...${wt.head}`.quiet().nothrow()
        UI.println(new TextDecoder().decode(d.stdout) || "  No differences\n")
      }
    })
  },
})

export const WorktreePruneCommand = cmd({
  command: "prune",
  describe: "prune stale worktree metadata",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      const result = await $`git worktree prune --verbose`.quiet().nothrow()
      const out = new TextDecoder().decode(result.stdout).trim()
      UI.println(out || "✓ Nothing to prune")
    })
  },
})

export const WorktreeRenameCommand = cmd({
  command: "rename <oldName> <newName>",
  describe: "rename a worktree",
  builder: (yargs: Argv) =>
    yargs
      .positional("oldName", {
        describe: "current name of the worktree",
        type: "string",
        demandOption: true,
      })
      .positional("newName", {
        describe: "new name for the worktree",
        type: "string",
        demandOption: true,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await $`git worktree list --porcelain`.quiet().nothrow()
      const lines = new TextDecoder().decode(result.stdout).split("\n")
      const worktrees: { path: string; branch: string }[] = []
      let cur: { path?: string; branch?: string } = {}
      for (const l of lines) {
        if (l.startsWith("worktree ")) {
          if (cur.path && cur.branch) worktrees.push({ path: cur.path, branch: cur.branch })
          cur = { path: l.slice(9).trim() }
        } else if (l.startsWith("branch ")) {
          cur.branch = l.slice(15).trim()
        }
      }
      if (cur.path && cur.branch) worktrees.push({ path: cur.path, branch: cur.branch })

      const oldWorktree = worktrees.find((w) => w.branch === `refs/heads/${args.oldName}`)
      if (!oldWorktree) {
        UI.error(`Worktree not found: ${args.oldName}`)
        process.exit(1)
      }

      const pathParts = oldWorktree.path.split(/[\\/]/)
      const parentDir = pathParts.slice(0, -1).join("/")
      const newPath = `${parentDir}/${args.newName}`

      await $`git worktree move ${oldWorktree.path} ${newPath}`.quiet()

      UI.println(
        `${UI.Style.TEXT_SUCCESS_BOLD}Renamed worktree${UI.Style.TEXT_NORMAL} from ${args.oldName} to ${args.newName}`,
      )
    })
  },
})
