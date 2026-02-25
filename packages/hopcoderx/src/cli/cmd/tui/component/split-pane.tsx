import { createContext, createMemo, createSignal, Show, useContext, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "./border"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"

const MIN_PANE = 40
const DEFAULT_RIGHT = 60
const SPLIT_THRESHOLD = 160

export type PanelTab = "files" | "preview" | "diff"

interface SplitPaneContext {
  rightVisible: () => boolean
  rightWidth: () => number
  leftWidth: () => number
  tab: () => PanelTab
  toggle: () => void
  setTab: (t: PanelTab) => void
  resize: (delta: number) => void
}

const ctx = createContext<SplitPaneContext>()

export function useSplitPane() {
  const c = useContext(ctx)
  if (!c) throw new Error("useSplitPane must be used within a SplitPane")
  return c
}

export function SplitPane(props: {
  left: () => JSX.Element
  right: () => JSX.Element
  sidebarWidth: number
}) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const kv = useKV()

  const [open, setOpen] = kv.signal("split_pane_open", false)
  const [width, setWidth] = kv.signal("split_pane_width", DEFAULT_RIGHT)
  const [tab, setTab] = kv.signal<PanelTab>("split_pane_tab", "files")

  const available = createMemo(() => dimensions().width - props.sidebarWidth - 4)
  const canSplit = createMemo(() => available() >= SPLIT_THRESHOLD)

  const rightVisible = createMemo(() => open() && canSplit())
  const rightWidth = createMemo(() => {
    if (!rightVisible()) return 0
    const w = Math.min(Math.max(width(), MIN_PANE), available() - MIN_PANE)
    return w
  })
  const leftWidth = createMemo(() => available() - rightWidth() - (rightVisible() ? 1 : 0))

  const toggle = () => setOpen((prev) => !prev)
  const resize = (delta: number) => setWidth(() => Math.max(MIN_PANE, width() + delta))

  const value: SplitPaneContext = {
    rightVisible,
    rightWidth,
    leftWidth,
    tab,
    toggle,
    setTab: (t: PanelTab) => setTab(() => t),
    resize,
  }

  return (
    <ctx.Provider value={value}>
      <box flexDirection="row" flexGrow={1}>
        <box width={leftWidth()} flexDirection="column">
          {props.left()}
        </box>
        <Show when={rightVisible()}>
          <box
            width={1}
            height="100%"
            border={SplitBorder.border}
            customBorderChars={SplitBorder.customBorderChars}
            borderColor={theme.border}
          />
          <box width={rightWidth()} flexDirection="column">
            {props.right()}
          </box>
        </Show>
      </box>
    </ctx.Provider>
  )
}
