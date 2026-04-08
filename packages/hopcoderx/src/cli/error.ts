import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { UI } from "./ui"

const DOCS = "https://hopcoder.dev/docs"

function suggest(...lines: string[]) {
  return "\n" + lines.map((l) => `  ${l}`).join("\n")
}

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return [
      `MCP server "${input.data.name}" failed to connect.`,
      suggest(
        `Check the server URL and credentials in your hopcoderx.json`,
        `Run: \x1b[1mhopcoderx mcp list\x1b[0m to see configured servers`,
        `Run: \x1b[1mhopcoderx doctor\x1b[0m to diagnose connectivity issues`,
        `Docs: ${DOCS}/mcp`,
      ),
    ].join("")
  if (Provider.ModelNotFoundError.isInstance(input)) {
    const { providerID, modelID, suggestions } = input.data
    return [
      `Model not found: \x1b[1m${providerID}/${modelID}\x1b[0m`,
      suggest(
        ...(Array.isArray(suggestions) && suggestions.length
          ? [`Did you mean: \x1b[36m${suggestions.join("\x1b[0m, \x1b[36m")}\x1b[0m`]
          : []),
        `Run: \x1b[1mhopcoderx models ${providerID}\x1b[0m to list available models`,
        `Run: \x1b[1mhopcoderx models --refresh\x1b[0m to refresh the model list`,
        `Check your config: \x1b[2mhopcoderx.json → model\x1b[0m`,
        `Docs: ${DOCS}/config#model`,
      ),
    ].join("")
  }
  if (Provider.InitError.isInstance(input)) {
    return [
      `Failed to initialize provider \x1b[1m${input.data.providerID}\x1b[0m`,
      suggest(
        `Check your API key: \x1b[1mhopcoderx auth ${input.data.providerID}\x1b[0m`,
        `Run: \x1b[1mhopcoderx doctor\x1b[0m to check provider health`,
        `Docs: ${DOCS}/providers/${input.data.providerID}`,
      ),
    ].join("")
  }
  if (Config.JsonError.isInstance(input)) {
    return [
      `Config file at \x1b[1m${input.data.path}\x1b[0m is not valid JSON(C)` +
        (input.data.message ? `: ${input.data.message}` : ""),
      suggest(
        `Open the file and check for syntax errors (missing commas, trailing commas, etc.)`,
        `Run: \x1b[1mhopcoderx doctor\x1b[0m to validate your config`,
        `Docs: ${DOCS}/config`,
      ),
    ].join("")
  }
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return [
      `Directory "${input.data.dir}" in ${input.data.path} is not valid.`,
      suggest(
        `Rename it to: \x1b[1m${input.data.suggestion}\x1b[0m`,
        `Or remove it entirely`,
        `This is a common typo — check for extra dots or capitalization`,
      ),
    ].join("")
  }
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) return input.data.message
  if (Config.InvalidError.isInstance(input))
    return [
      `Configuration is invalid${input.data.path && input.data.path !== "config" ? ` at \x1b[1m${input.data.path}\x1b[0m` : ""}` +
        (input.data.message ? `: ${input.data.message}` : ""),
      ...(input.data.issues?.map((issue) => "\n  \x1b[33m↳\x1b[0m " + issue.message + " \x1b[2m" + issue.path.join(".") + "\x1b[0m") ?? []),
      suggest(
        `Docs: ${DOCS}/config`,
        `Run: \x1b[1mhopcoderx doctor\x1b[0m to validate your config`,
      ),
    ].join("")

  if (UI.CancelledError.isInstance(input)) return ""
}

export function FormatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    return input.stack ?? `${input.name}: ${input.message}`
  }

  if (typeof input === "object" && input !== null) {
    try {
      return JSON.stringify(input, null, 2)
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(input)
}

