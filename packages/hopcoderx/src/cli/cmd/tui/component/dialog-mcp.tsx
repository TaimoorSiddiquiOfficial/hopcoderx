import { createMemo, createSignal, Show, For, Switch, Match } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy, filter } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { McpRegistry } from "@/mcp/registry"
import { DialogMcpRegistry } from "./dialog-mcp-registry"

function Status(props: { enabled: boolean; loading: boolean; status?: string }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return (
      <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>
        ✓ Enabled
      </span>
    )
  }
  // Show specific status for non-enabled states
  switch (props.status) {
    case "needs_auth":
      return <span style={{ fg: theme.warning }}>⚠ Auth Required</span>
    case "failed":
      return <span style={{ fg: theme.error }}>✗ Failed</span>
    case "disabled":
    default:
      return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
  }
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal<string>("all") // all, connected, failed, disabled
  const [view, setView] = createSignal<"installed" | "registry">("installed")

  const filteredMcpData = createMemo(() => {
    const mcpData = sync.data.mcp ?? {}
    const filterValue = filter()

    if (filterValue === "all") return mcpData

    return Object.fromEntries(
      Object.entries(mcpData).filter(([, status]) => {
        if (filterValue === "connected") return status.status === "connected"
        if (filterValue === "failed") return status.status === "failed"
        if (filterValue === "disabled") return status.status === "disabled"
        if (filterValue === "needs_auth") return status.status === "needs_auth"
        return true
      })
    )
  })

  const options = createMemo(() => {
    const mcpData = filteredMcpData()
    const loadingMcp = loading()

    return pipe(
      mcpData,
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => {
        // Check if this MCP is in the registry for extra metadata
        const registryEntry = McpRegistry.getByName(name)
        const category = registryEntry ? registryEntry.category : "custom"

        return {
          value: name,
          title: name,
          description: status.status === "failed" ? status.error || "failed" : status.status,
          footer: (
            <Status
              enabled={local.mcp.isEnabled(name)}
              loading={loadingMcp === name}
              status={status.status}
            />
          ),
          category: category.charAt(0).toUpperCase() + category.slice(1),
          metadata: { registryEntry, status },
        }
      })
    )
  })

  const installedCount = createMemo(() => {
    return Object.keys(sync.data.mcp ?? {}).length
  })

  const connectedCount = createMemo(() => {
    return Object.values(sync.data.mcp ?? {}).filter((s) => s.status === "connected").length
  })

  const failedCount = createMemo(() => {
    return Object.values(sync.data.mcp ?? {}).filter((s) => s.status === "failed").length
  })

  const needsAuthCount = createMemo(() => {
    return Object.values(sync.data.mcp ?? {}).filter((s) => s.status === "needs_auth").length
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("r")[0],
      title: "refresh",
      onTrigger: async () => {
        setLoading("refresh")
        try {
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          console.error("Failed to refresh MCP status:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("i")[0],
      title: "install",
      onTrigger: () => {
        dialog.replace(() => <DialogMcpRegistry />)
      },
    },
    {
      keybind: Keybind.parse("d")[0],
      title: "disconnect all",
      onTrigger: async () => {
        const connected = Object.entries(sync.data.mcp ?? {}).filter(
          ([, s]) => s.status === "connected"
        )
        for (const [name] of connected) {
          await local.mcp.toggle(name)
        }
        const status = await sdk.client.mcp.status()
        if (status.data) {
          sync.set("mcp", status.data)
        }
      },
    },
    {
      keybind: Keybind.parse("f")[0],
      title: "filter",
      onTrigger: () => {
        // Cycle through filters: all -> connected -> failed -> disabled -> needs_auth -> all
        const filters = ["all", "connected", "failed", "disabled", "needs_auth"]
        const currentIndex = filters.indexOf(filter())
        setFilter(filters[(currentIndex + 1) % filters.length])
      },
    },
    {
      keybind: Keybind.parse("?")[0],
      title: "help",
      onTrigger: () => {
        // Show help dialog - could be implemented
      },
    },
  ])

  const title = createMemo(() => {
    const filterLabel = filter() !== "all" ? ` (${filter()})` : ""
    return `MCP Servers (${connectedCount()}/${installedCount()} connected)${filterLabel}`
  })

  return (
    <>
      <box flexDirection="column" gap={1}>
        <box flexDirection="row" gap={2}>
          <text style={{ fg: useTheme().theme.textMuted }}>
            Space: Toggle | R: Refresh | I: Install | D: Disconnect All | F: Filter | ?: Help
          </text>
        </box>
        <Show when={failedCount() > 0}>
          <text style={{ fg: useTheme().theme.error }}>
            ⚠ {failedCount()} MCP server(s) failed to connect
          </text>
        </Show>
        <Show when={needsAuthCount() > 0}>
          <text style={{ fg: useTheme().theme.warning }}>
            ⚠ {needsAuthCount()} MCP server(s) need authentication
          </text>
        </Show>
      </box>
      <DialogSelect
        ref={setRef}
        title={title()}
        options={options()}
        keybind={keybinds()}
        onSelect={(option) => {
          // Don't close on select, only on escape
        }}
      />
    </>
  )
}
