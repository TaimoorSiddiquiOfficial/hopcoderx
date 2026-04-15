import { Log } from "../util/log"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { parse as parseJsonc } from "jsonc-parser"

export interface AliasConfig {
  [alias: string]: string | string[]
}

/**
 * Load user-defined command aliases from global config
 * Aliases allow users to create custom shortcuts for commands
 *
 * Example config:
 * {
 *   "aliases": {
 *     "s": "session",
 *     "st": "status",
 *     "dc": ["daemon", "start"],
 *     "mf": ["models", "favorite"]
 *   }
 * }
 */
export async function loadAliases(): Promise<AliasConfig> {
  try {
    // Read aliases directly from global config to avoid instance context dependency
    // Aliases are user-level shortcuts stored in ~/.config/hopcoderx/hopcoderx.json{,c}
    const configDir = Global.Path.config
    const candidates = ["hopcoderx.jsonc", "hopcoderx.json", "config.json"]

    for (const file of candidates) {
      const filepath = `${configDir}/${file}`
      const content = await Filesystem.readText(filepath).catch(() => undefined)
      if (content) {
        const data = parseJsonc(content) as any
        const aliases = data.aliases ?? {}

        // Validate aliases - must map to strings or string arrays
        const validated: AliasConfig = {}
        for (const [alias, value] of Object.entries(aliases)) {
          if (typeof value === "string") {
            validated[alias] = value
          } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
            validated[alias] = value
          } else {
            Log.Default.warn("aliases", { message: `Invalid alias definition: ${alias} = ${JSON.stringify(value)}` })
          }
        }

        return validated
      }
    }

    return {}
  } catch (error) {
    Log.Default.warn("aliases", { message: "Failed to load aliases", error })
    return {}
  }
}

/**
 * Expand an alias to its command string or array
 */
export function expandAlias(aliases: AliasConfig, input: string): string | string[] | null {
  return aliases[input] ?? null
}

/**
 * Check if a command should be aliased
 */
export function isAlias(aliases: AliasConfig, input: string): boolean {
  return input in aliases
}

/**
 * Get all defined aliases
 */
export function getAliasList(aliases: AliasConfig): Array<{ alias: string; command: string }> {
  return Object.entries(aliases).map(([alias, command]) => ({
    alias,
    command: typeof command === "string" ? command : command.join(" "),
  }))
}
