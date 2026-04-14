import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { Event } from "@hopcoderx/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { validateSessionSelection, withSessionSelectionOptions } from "@/cli/session-selection"
import {
  resolveDirectorySelection,
  validateDirectorySelection,
  withDirectorySelectionOption,
} from "@/cli/directory-selection"
import { buildTuiStartupArgs, resolveStartupPrompt, withTuiStartupOptions } from "@/cli/tui-startup"

declare global {
  const HOPCODERX_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
  }
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start HopCoderX tui",
  builder: (yargs) =>
    withSessionSelectionOptions(
      withDirectorySelectionOption(
        withTuiStartupOptions(withNetworkOptions(yargs))
          .positional("project", {
            type: "string",
            describe: "path to start HopCoderX in",
          }),
        "directory to start HopCoderX in",
      ),
    ),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      const sessionSelectionError = validateSessionSelection(args)
      if (sessionSelectionError) {
        UI.error(sessionSelectionError)
        process.exitCode = 1
        return
      }

      const directorySelectionError = validateDirectorySelection(args)
      if (directorySelectionError) {
        UI.error(directorySelectionError)
        process.exitCode = 1
        return
      }

      const cwd = (() => {
        try {
          return resolveDirectorySelection(args, { defaultToCwd: true })
        } catch (error) {
          UI.error(error instanceof Error ? error.message : String(error))
          return
        }
      })()
      if (!cwd) {
        process.exitCode = 1
        return
      }
      const localWorker = new URL("./worker.ts", import.meta.url)
      const distWorker = new URL("./cli/cmd/tui/worker.js", import.meta.url)
      const workerPath = await iife(async () => {
        if (typeof HOPCODERX_WORKER_PATH !== "undefined") return HOPCODERX_WORKER_PATH
        if (await Filesystem.exists(fileURLToPath(distWorker))) return distWorker
        return localWorker
      })

      const worker = new Worker(workerPath, {
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      })
      worker.onerror = (e) => {
        Log.Default.error("worker error", { error: e.message || e })
      }
      const client = Rpc.client<typeof rpc>(worker)
      process.on("uncaughtException", (e) => {
        Log.Default.error("uncaught exception", { error: e.message || e })
      })
      process.on("unhandledRejection", (e) => {
        Log.Default.error("unhandled rejection", { error: e instanceof Error ? e.message : String(e) })
      })
      process.on("SIGUSR2", async () => {
        await client.call("reload", undefined)
      })

      const prompt = await resolveStartupPrompt(args.prompt)

      // Check if server should be started (port or hostname explicitly set in CLI or config)
      const networkOpts = await resolveNetworkOptions(args)
      const shouldStartServer =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        networkOpts.mdns ||
        networkOpts.port !== 0 ||
        networkOpts.hostname !== "127.0.0.1"

      let url: string
      let customFetch: typeof fetch | undefined
      let events: EventSource | undefined

      if (shouldStartServer) {
        // Start HTTP server for external access
        const server = await client.call("server", networkOpts)
        url = server.url
      } else {
        // Use direct RPC communication (no HTTP)
        url = "http://hopcoderx.internal"
        customFetch = createWorkerFetch(client)
        events = createEventSource(client)
      }

      const tuiPromise = tui({
        url,
        fetch: customFetch,
        events,
        args: buildTuiStartupArgs(args, prompt),
        onExit: async () => {
          await client.call("shutdown", undefined)
        },
      })

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000)

      await tuiPromise
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
