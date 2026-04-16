/**
 * MCP Inspector CLI Command
 *
 * Usage:
 *   hopcoderx mcp inspect      - Open interactive inspector
 *   hopcoderx mcp inspect --quick  - Quick status overview
 */

import { cmd } from "./cmd"
import { McpInspector } from "../../mcp/inspector"
import { Instance } from "../../project/instance"
import type { Argv } from "yargs"

export const McpInspectCommand = cmd({
  command: "inspect [server]",
  describe: "open interactive MCP server inspector",
  builder(yargs: Argv) {
    return yargs
      .positional("server", {
        type: "string",
        describe: "Server name to inspect (optional, shows selection menu if omitted)",
      })
      .option("quick", {
        type: "boolean",
        describe: "Show quick status overview for all servers",
        default: false,
      })
      .option("json", {
        type: "boolean",
        describe: "Output as JSON",
        default: false,
      })
  },
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (args.quick) {
          await McpInspector.quickStatus()
          return
        }

        if (args.server) {
          // Direct server inspection - to be implemented
          console.log(`Inspecting server: ${args.server}`)
          console.log("Full server inspection coming soon!")
          return
        }

        // Interactive inspector
        await McpInspector.run()
      },
    })
  },
})
