import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Log } from "../util/log"

// Bun-specific error class for module resolution failures
declare const ResolveMessage: typeof Error
import { UI } from "./ui"
import { Installation } from "../installation"
import { NamedError } from "@hopcoderx/util/error"
import { FormatError } from "./error"
import { Filesystem } from "../util/filesystem"
import { EOL } from "os"
import path from "path"
import { Global } from "../global"
import { JsonMigration } from "../storage/json-migration"
import { Database } from "../storage/db"

type BootstrapOptions = {
  logLevel?: Log.Level
}

async function ensureDatabaseMigration() {
  const marker = path.join(Global.Path.data, "hopcoderx.db")
  if (await Filesystem.exists(marker)) return

  const tty = process.stderr.isTTY
  process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
  const width = 36
  const orange = "\x1b[38;5;214m"
  const muted = "\x1b[0;2m"
  const reset = "\x1b[0m"
  let last = -1

  if (tty) process.stderr.write("\x1b[?25l")
  try {
    await JsonMigration.run(Database.Client().$client, {
      progress: (event) => {
        const percent = Math.floor((event.current / event.total) * 100)
        if (percent === last && event.current !== event.total) return
        last = percent
        if (tty) {
          const fill = Math.round((percent / 100) * width)
          const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
          process.stderr.write(
            `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
          )
          if (event.current === event.total) process.stderr.write("\n")
        } else {
          process.stderr.write(`sqlite-migration:${percent}${EOL}`)
        }
      },
    })
  } finally {
    if (tty) process.stderr.write("\x1b[?25h")
    else process.stderr.write(`sqlite-migration:done${EOL}`)
  }

  process.stderr.write("Database migration complete." + EOL)
}

async function initializeRuntime(options: BootstrapOptions) {
  await Log.init({
    print: process.argv.includes("--print-logs"),
    dev: Installation.isLocal(),
    level: options.logLevel ?? (Installation.isLocal() ? "DEBUG" : "INFO"),
  })

  process.env.AGENT = "1"
  process.env.HOPCODERX = "1"

  Log.Default.info("hopcoderx", {
    version: Installation.VERSION,
    args: process.argv.slice(2),
  })

  await ensureDatabaseMigration()
}

const TOP_LEVEL_HELP_HIDDEN_OPTION_PATTERNS = [
  /\b--model\b/,
  /\b--continue\b/,
  /\b--session\b/,
  /\b--fork\b/,
  /\b--prompt\b/,
  /\b--agent\b/,
  /\b--port\b/,
  /\b--hostname\b/,
  /\b--mdns-domain\b/,
  /\b--mdns\b/,
  /\b--cors\b/,
]

export function isTopLevelHelpRequest(argv = hideBin(process.argv)) {
  let helpRequested = false

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token) continue
    if (token === "--") return false
    if (token === "--help" || token === "-h") {
      helpRequested = true
      continue
    }
    if (token === "--print-logs") continue
    if (token === "--log-level") {
      index++
      continue
    }
    if (token.startsWith("--log-level=")) continue
    if (token.startsWith("-")) return false
    return false
  }

  return helpRequested
}

export async function renderTopLevelHelp(cli: ReturnType<typeof yargs>) {
  let help = await cli.getHelp()
  help = help.replace(/\r?\nPositionals:\r?\n[\s\S]*?(?=\r?\nOptions:)/, "")
  help = help
    .split(/\r?\n/)
    .filter((line) => !TOP_LEVEL_HELP_HIDDEN_OPTION_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
  return help.endsWith("\n") ? help : help + "\n"
}

export function registerProcessHandlers() {
  process.on("unhandledRejection", (e) => {
    Log.Default.error("rejection", {
      e: e instanceof Error ? e.message : e,
    })
  })

  process.on("uncaughtException", (e) => {
    Log.Default.error("exception", {
      e: e instanceof Error ? e.message : e,
    })
  })
}

export function createCli() {
  const cli = yargs(hideBin(process.argv))
    .parserConfiguration({ "populate--": true })
    .scriptName("hopcoderx")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", Installation.VERSION)
    .alias("version", "v")
    .option("print-logs", {
      describe: "print logs to stderr",
      type: "boolean",
    })
    .option("log-level", {
      describe: "log level",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .middleware(async (opts) => {
      await initializeRuntime({
        logLevel: opts.logLevel as Log.Level | undefined,
      })
    })
    .usage("\n" + UI.logo())
    .fail((msg, err) => {
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:")
      ) {
        if (err) throw err
        cli.showHelp("log")
      }
      if (err) throw err
      process.exit(1)
    })
    .strict()

  return cli
}

export function handleFatal(e: unknown) {
  const data: Record<string, any> = {}

  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, obj.data)
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (typeof ResolveMessage !== "undefined" && e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }

  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write((e instanceof Error ? e.message : String(e)) + EOL)
  }
  process.exitCode = 1
}
