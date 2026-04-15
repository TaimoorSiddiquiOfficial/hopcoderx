/**
 * tmux Integration Utility
 *
 * Detects tmux environment, adapts rendering, and handles pane detection.
 * Provides utilities for tmux-specific features and workarounds.
 */

import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

export namespace Tmux {
  export interface TmuxInfo {
    isInTmux: boolean
    sessionId?: string
    windowId?: string
    paneId?: string
    paneWidth?: number
    paneHeight?: number
    windows?: TmuxWindow[]
  }

  export interface TmuxWindow {
    windowId: string
    windowName: string
    windowActive: boolean
    panes: TmuxPane[]
  }

  export interface TmuxPane {
    paneId: string
    paneActive: boolean
    paneWidth: number
    paneHeight: number
    paneTitle?: string
  }

  /**
   * Check if running inside tmux
   */
  export function isInTmux(): boolean {
    return !!(process.env.TMUX || process.env.TMUX_PANE)
  }

  /**
   * Get tmux session information
   */
  export async function getInfo(): Promise<TmuxInfo> {
    if (!isInTmux()) {
      return { isInTmux: false }
    }

    try {
      const [sessionId, windowId, paneId] = await Promise.all([
        getTmuxVariable("session_id").catch(() => undefined),
        getTmuxVariable("window_id").catch(() => undefined),
        getTmuxVariable("pane_id").catch(() => undefined),
      ])

      const paneDimensions = await getPaneDimensions(paneId).catch(() => undefined)

      return {
        isInTmux: true,
        sessionId,
        windowId,
        paneId,
        ...paneDimensions,
      }
    } catch (error) {
      return { isInTmux: true }
    }
  }

  /**
   * Get a tmux variable using display-message
   */
  async function getTmuxVariable(variable: string): Promise<string> {
    const result = await execFileAsync("tmux", ["display-message", "-p", `#{${variable}}`])
    return result.stdout.trim()
  }

  /**
   * Get pane dimensions
   */
  async function getPaneDimensions(paneId?: string): Promise<{ paneWidth?: number; paneHeight?: number }> {
    if (!paneId) {
      return {}
    }

    const result = await execFileAsync("tmux", [
      "list-panes",
      "-F",
      "#{pane_id} #{pane_width} #{pane_height}",
    ])

    const lines = result.stdout.trim().split("\n")
    for (const line of lines) {
      const [id, width, height] = line.split(" ")
      if (id === paneId) {
        return {
          paneWidth: parseInt(width, 10),
          paneHeight: parseInt(height, 10),
        }
      }
    }

    return {}
  }

  /**
   * List all tmux windows and panes for the current session
   */
  export async function listWindows(): Promise<TmuxWindow[]> {
    if (!isInTmux()) {
      return []
    }

    try {
      const result = await execFileAsync("tmux", [
        "list-windows",
        "-F",
        "#{window_id}|#{window_name}|#{window_active}|#{pane_id}|#{pane_active}|#{pane_width}|#{pane_height}|#{pane_title}",
      ])

      const windows = new Map<string, TmuxWindow>()

      for (const line of result.stdout.trim().split("\n")) {
        const [windowId, windowName, windowActive, paneId, paneActive, paneWidth, paneHeight, paneTitle] =
          line.split("|")

        if (!windows.has(windowId)) {
          windows.set(windowId, {
            windowId,
            windowName,
            windowActive: windowActive === "1",
            panes: [],
          })
        }

        const window = windows.get(windowId)!
        window.panes.push({
          paneId,
          paneActive: paneActive === "1",
          paneWidth: parseInt(paneWidth, 10),
          paneHeight: parseInt(paneHeight, 10),
          paneTitle: paneTitle || undefined,
        })
      }

      return Array.from(windows.values())
    } catch (error) {
      return []
    }
  }

  /**
   * Create a new tmux window
   */
  export async function newWindow(name?: string): Promise<string | undefined> {
    if (!isInTmux()) {
      return undefined
    }

    try {
      const args = ["new-window"]
      if (name) {
        args.push("-n", name)
      }
      const result = await execFileAsync("tmux", args)
      return result.stdout.trim()
    } catch (error) {
      return undefined
    }
  }

  /**
   * Select a tmux window by ID or name
   */
  export async function selectWindow(target: string): Promise<boolean> {
    if (!isInTmux()) {
      return false
    }

    try {
      await execFileAsync("tmux", ["select-window", "-t", target])
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Rename the current tmux window
   */
  export async function renameWindow(name: string): Promise<boolean> {
    if (!isInTmux()) {
      return false
    }

    try {
      await execFileAsync("tmux", ["rename-window", name])
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Set tmux pane title
   */
  export async function setPaneTitle(title: string): Promise<boolean> {
    if (!isInTmux()) {
      return false
    }

    try {
      // Use escape sequence to set pane title
      process.stdout.write(`\x1b]2;${title}\x07`)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Check if tmux is installed and available
   */
  export async function isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("tmux", ["-V"])
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get tmux version
   */
  export async function getVersion(): Promise<string | undefined> {
    try {
      const result = await execFileAsync("tmux", ["-V"])
      return result.stdout.trim().replace("tmux ", "")
    } catch (error) {
      return undefined
    }
  }

  /**
   * Adapt TUI settings for tmux environment
   * - Disable certain features that don't work well in tmux
   * - Adjust rendering for pane constraints
   */
  export function getTmuxAdaptations(): {
    disableMouse: boolean
    disableTrueColor: boolean
    forceMinimalRendering: boolean
    maxColumns?: number
    maxRows?: number
  } {
    if (!isInTmux()) {
      return {
        disableMouse: false,
        disableTrueColor: false,
        forceMinimalRendering: false,
      }
    }

    // tmux generally handles mouse well in modern versions
    // But some features may need adaptation
    return {
      disableMouse: false,
      disableTrueColor: process.env.TMUX_TERM === "screen", // Old tmux versions
      forceMinimalRendering: false,
    }
  }
}
