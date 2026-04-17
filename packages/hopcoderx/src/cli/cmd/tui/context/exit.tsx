import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
  /** Register a callback to flush state before process exit */
  onFlush: (fn: () => Promise<void>) => () => void
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    const flushCallbacks = new Set<() => Promise<void>>()
    const store = {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    }
    const exit: Exit = Object.assign(
      async (reason?: unknown) => {
        // Flush registered state (e.g., draft persistence)
        await Promise.allSettled([...flushCallbacks].map((fn) => fn()))
        // Reset window title before destroying renderer
        renderer.setTerminalTitle("")
        renderer.destroy()
        win32FlushInputBuffer()
        if (reason) {
          const formatted = FormatError(reason) ?? FormatUnknownError(reason)
          if (formatted) {
            process.stderr.write(formatted + "\n")
          }
        }
        const text = store.get()
        if (text) process.stdout.write(text + "\n")
        await input.onExit?.()
      },
      {
        message: store,
        onFlush: (fn: () => Promise<void>) => {
          flushCallbacks.add(fn)
          return () => {
            flushCallbacks.delete(fn)
          }
        },
      },
    )
    return exit
  },
})
