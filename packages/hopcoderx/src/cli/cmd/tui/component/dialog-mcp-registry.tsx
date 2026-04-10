import { createMemo, createSignal, Show, For, Switch, Match } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes, RGBA } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { McpRegistry } from "@/mcp/registry"
import type { Config } from "@/config/config"

// Helper component for category badges
function CategoryBadge(props: { category: McpRegistry.Category }) {
  const { theme } = useTheme()
  const categories = McpRegistry.categories
  const cat = categories[props.category]

  return (
    <span style={{ fg: theme.info, attributes: TextAttributes.DIM }}>
      {cat.icon} {cat.label}
    </span>
  )
}

// Helper component for platform compatibility
function PlatformIndicator(props: { platforms: McpRegistry.Platform[] }) {
  const { theme } = useTheme()
  const currentPlatform = process.platform
  const platformMap: Record<string, McpRegistry.Platform> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  }
  const current = platformMap[currentPlatform] || "linux"
  const isCompatible = props.platforms.includes(current) || props.platforms.includes("cross-platform")

  return (
    <span style={{ fg: isCompatible ? theme.success : theme.error }}>
      {isCompatible ? "●" : "✗"} {props.platforms.includes("cross-platform") ? "All Platforms" : props.platforms.join(", ")}
    </span>
  )
}

// Helper component for requirements
function RequirementsList(props: { requirements: McpRegistry.Requirement[] }) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={1}>
      <For each={props.requirements}>
        {(req) => (
          <box flexDirection="row" gap={1}>
            <span style={{ fg: theme.textMuted }}>•</span>
            <span style={{ fg: theme.text }}>
              {req.type === "nodejs" && "🟢 "}
              {req.type === "python" && "🐍 "}
              {req.type === "app" && "📱 "}
              {req.type === "api-key" && "🔑 "}
              {req.description}
            </span>
          </box>
        )}
      </For>
    </box>
  )
}

export function DialogMcpRegistry() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [selectedEntry, setSelectedEntry] = createSignal<McpRegistry.RegistryEntry | null>(null)
  const [categoryFilter, setCategoryFilter] = createSignal<McpRegistry.Category | "all">("all")
  const [showDetails, setShowDetails] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal("")

  // Check which MCPs are already installed
  const installedMcpNames = createMemo(() => {
    return new Set(Object.keys(sync.data.mcp ?? {}))
  })

  const filteredEntries = createMemo(() => {
    let entries = McpRegistry.registry

    // Filter by category
    if (categoryFilter() !== "all") {
      entries = McpRegistry.getByCategory(categoryFilter() as McpRegistry.Category)
    }

    // Filter by search query
    const query = searchQuery().trim()
    if (query) {
      entries = McpRegistry.search(query)
    }

    // Sort: featured first, then by stars
    return entries.sort((a, b) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      return (b.stars || 0) - (a.stars || 0)
    })
  })

  const options = createMemo(() => {
    const installed = installedMcpNames()
    const loadingName = loading()

    return filteredEntries().map((entry) => {
      const isInstalled = installed.has(entry.name)
      const isCompatible = McpRegistry.isCompatible(entry)
      const isLoading = loadingName === entry.name

      return {
        value: entry.name,
        title: `${entry.featured ? "⭐ " : ""}${entry.name}`,
        description: entry.description,
        footer: (
          <box flexDirection="row" gap={2}>
            <CategoryBadge category={entry.category} />
            <span style={{ fg: isInstalled ? theme.success : theme.textMuted }}>
              {isLoading ? "⋯ Installing" : isInstalled ? "✓ Installed" : isCompatible ? "○ Available" : "✗ Incompatible"}
            </span>
          </box>
        ),
        category: entry.category.charAt(0).toUpperCase() + entry.category.slice(1),
        metadata: { entry, isInstalled, isCompatible },
      }
    })
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("enter")[0],
      title: "install",
      onTrigger: async (option: DialogSelectOption<string>) => {
        const entry = McpRegistry.getByName(option.value)
        if (!entry) return

        if (installedMcpNames().has(entry.name)) {
          // Already installed, show details instead
          setSelectedEntry(entry)
          setShowDetails(true)
          return
        }

        setLoading(entry.name)
        try {
          // Add the MCP to config
          const config = McpRegistry.formatConfig(entry)
          await sdk.client.mcp.add({ name: entry.name, config })

          // Refresh status
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }

          // Show details after install
          setSelectedEntry(entry)
          setShowDetails(true)
        } catch (error) {
          console.error("Failed to install MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("d")[0],
      title: "details",
      onTrigger: (option: DialogSelectOption<string>) => {
        const entry = McpRegistry.getByName(option.value)
        if (entry) {
          setSelectedEntry(entry)
          setShowDetails(true)
        }
      },
    },
    {
      keybind: Keybind.parse("c")[0],
      title: "category",
      onTrigger: () => {
        const categories: (McpRegistry.Category | "all")[] = [
          "all",
          "adobe",
          "cloud",
          "automation",
          "design",
          "development",
          "productivity",
        ]
        const currentIndex = categories.indexOf(categoryFilter())
        setCategoryFilter(categories[(currentIndex + 1) % categories.length])
      },
    },
    {
      keybind: Keybind.parse("/")[0],
      title: "search",
      onTrigger: () => {
        // In a real implementation, this would focus a search input
        // For now, we toggle between empty search and a sample query
        setSearchQuery(searchQuery() ? "" : "adobe")
      },
    },
    {
      keybind: Keybind.parse("escape")[0],
      title: "back",
      onTrigger: () => {
        dialog.pop()
      },
    },
  ])

  const title = createMemo(() => {
    const category = categoryFilter() !== "all" ? ` [${categoryFilter()}]` : ""
    const search = searchQuery() ? ` /${searchQuery()}/` : ""
    return `MCP Registry${category}${search}`
  })

  // Show details view if an entry is selected
  if (showDetails() && selectedEntry()) {
    const entry = selectedEntry()!
    const isInstalled = installedMcpNames().has(entry.name)
    const isCompatible = McpRegistry.isCompatible(entry)

    return (
      <box flexDirection="column" padding={2} gap={1}>
        <box flexDirection="row" gap={1}>
          <text style={{ fg: theme.accent, attributes: TextAttributes.BOLD }}>{entry.name}</text>
          {entry.featured && <span style={{ fg: theme.warning }}>⭐ Featured</span>}
        </box>
        <text style={{ fg: theme.text }}>{entry.description}</text>
        
        <box flexDirection="row" gap={2}>
          <CategoryBadge category={entry.category} />
          <PlatformIndicator platforms={entry.platform} />
          {entry.stars && (
            <span style={{ fg: theme.warning }}>★ {entry.stars} stars</span>
          )}
        </box>

        <box marginTop={1}>
          <text style={{ fg: theme.textMuted, attributes: TextAttributes.UNDERLINE }}>
            Requirements:
          </text>
          <RequirementsList requirements={entry.requirements} />
        </box>

        <box marginTop={1}>
          <text style={{ fg: theme.textMuted, attributes: TextAttributes.UNDERLINE }}>
            Setup Instructions:
          </text>
          <text style={{ fg: theme.text }}>{entry.setupInstructions || "No setup instructions available."}</text>
        </box>

        <box marginTop={1}>
          <text style={{ fg: theme.textMuted, attributes: TextAttributes.UNDERLINE }}>Tags:</text>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <For each={entry.tags}>
              {(tag) => (
                <span style={{ fg: theme.info }}>#{tag}</span>
              )}
            </For>
          </box>
        </box>

        <box marginTop={2} flexDirection="row" gap={2}>
          <text style={{ fg: theme.textMuted }}>Repository: {entry.repository}</text>
        </box>

        <box marginTop={1}>
          <text style={{ fg: theme.textMuted }}>
            Press Enter to {isInstalled ? "reinstall" : "install"} | Escape to go back
          </text>
        </box>
      </box>
    )
  }

  return (
    <>
      <box flexDirection="column" gap={1}>
        <box flexDirection="row" gap={2}>
          <text style={{ fg: theme.textMuted }}>
            Enter: Install | D: Details | C: Category | /: Search | Escape: Back
          </text>
        </box>
        <Show when={categoryFilter() !== "all"}>
          <text style={{ fg: theme.info }}>
            📂 Category: {McpRegistry.categories[categoryFilter() as McpRegistry.Category]?.label}
          </text>
        </Show>
        <Show when={searchQuery()}>
          <text style={{ fg: theme.info }}>
            🔍 Search: "{searchQuery()}"
          </text>
        </Show>
      </box>
      <DialogSelect
        ref={setRef}
        title={title()}
        options={options()}
        keybind={keybinds()}
        onSelect={(option) => {
          // Handled by keybinds
        }}
      />
    </>
  )
}
