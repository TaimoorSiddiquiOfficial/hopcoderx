import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { tui } from "./app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { validateSessionSelection, withSessionSelectionOptions } from "@/cli/session-selection"
import { resolveDirectorySelection, withDirectorySelectionOption } from "@/cli/directory-selection"
import { buildServerAuthHeaders } from "@/cli/server-auth"
import { buildTuiStartupArgs, resolveStartupPrompt, withTuiStartupOptions } from "@/cli/tui-startup"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running HopCoderX server",
  builder: (yargs) =>
    withSessionSelectionOptions(
      withDirectorySelectionOption(
        withTuiStartupOptions(
          yargs
            .positional("url", {
              type: "string",
              describe: "http://localhost:4096",
              demandOption: true,
            })
            .option("password", {
              alias: ["p"],
              type: "string",
              describe: "basic auth password (defaults to HOPCODERX_SERVER_PASSWORD)",
            }),
        ),
        "directory to run in",
      ),
    ),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      const sessionSelectionError = validateSessionSelection(args)
      if (sessionSelectionError) {
        UI.error(sessionSelectionError)
        process.exitCode = 1
        return
      }

      const directory = resolveDirectorySelection(args, {
        allowUnresolvedDir: true,
      })
      const headers = buildServerAuthHeaders(args.password ?? process.env.HOPCODERX_SERVER_PASSWORD)
      const prompt = await resolveStartupPrompt(args.prompt)
      await tui({
        url: args.url,
        args: buildTuiStartupArgs(args, prompt),
        directory,
        headers,
      })
    } finally {
      unguard?.()
    }
  },
})
