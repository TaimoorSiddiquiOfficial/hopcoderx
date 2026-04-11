import type { Argv } from "yargs"

export type SessionSelectionArgs = {
  continue?: boolean
  session?: string
  fork?: boolean
}

export function withSessionSelectionOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("continue", {
      alias: ["c"],
      describe: "continue the last session",
      type: "boolean",
    })
    .option("session", {
      alias: ["s"],
      type: "string",
      describe: "session id to continue",
    })
    .option("fork", {
      type: "boolean",
      describe: "fork the session when continuing (use with --continue or --session)",
    })
}

export function validateSessionSelection(args: SessionSelectionArgs) {
  if (args.continue && args.session) {
    return "Use either --continue or --session, not both"
  }

  if (args.fork && !args.continue && !args.session) {
    return "--fork requires --continue or --session"
  }
}
