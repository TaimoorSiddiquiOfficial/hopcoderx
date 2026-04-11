import path from "path"
import type { Argv } from "yargs"

export type DirectorySelectionArgs = {
  project?: string
  dir?: string
}

type DirectorySelectionOptions = {
  baseCwd?: string
  allowUnresolvedDir?: boolean
  defaultToCwd?: boolean
}

export function withDirectorySelectionOption<T>(yargs: Argv<T>, describe: string) {
  return yargs.option("dir", {
    type: "string",
    describe,
  })
}

export function validateDirectorySelection(args: DirectorySelectionArgs) {
  if (args.project && args.dir) {
    return "Use either [project] or --dir, not both"
  }
}

export function resolveDirectorySelection(
  args: DirectorySelectionArgs,
  options: DirectorySelectionOptions = {},
) {
  const baseCwd = options.baseCwd ?? process.env.PWD ?? process.cwd()
  const target = args.dir ?? args.project
  if (!target) {
    return options.defaultToCwd ? process.cwd() : undefined
  }

  const resolved = path.resolve(baseCwd, target)

  try {
    process.chdir(resolved)
    return process.cwd()
  } catch {
    if (options.allowUnresolvedDir && args.dir) {
      return args.dir
    }
    throw new Error(`Failed to change directory to ${resolved}`)
  }
}
