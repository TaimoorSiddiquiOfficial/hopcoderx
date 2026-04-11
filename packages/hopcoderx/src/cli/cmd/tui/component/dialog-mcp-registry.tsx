import { createMemo, createSignal, Show, For } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { McpRegistry } from "@/mcp/registry"
import { useKeyboard } from "@opentui/solid"

// Helper component for category badges — must render <text> so it can be a child of <box>
function CategoryBadge(props: { category: McpRegistry.Category }) {
  const { theme } = useTheme()
  const cat = McpRegistry.categories[props.category]
  return (
    <text fg={theme.info} attributes={TextAttributes.DIM}>
      {cat?.icon ?? ""} {cat?.label ?? props.category}
    </text>
  )
}

// Helper component for platform compatibility — must render <text> so it can be a child of <box>
function PlatformIndicator(props: { platforms: McpRegistry.Platform[] }) {
  const { theme } = useTheme()
  const platformMap: Record<string, McpRegistry.Platform> = {
    win32: "windows",
    darwin: "macos",
    linux: "linux",
  }
  const current = platformMap[process.platform] || "linux"
  const isCompatible = props.platforms.includes(current) || props.platforms.includes("cross-platform")
  return (
    <text fg={isCompatible ? theme.success : theme.error}>
      {isCompatible ? "●" : "✗"} {props.platforms.includes("cross-platform") ? "All Platforms" : props.platforms.join(", ")}
    </text>
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
            <text fg={theme.textMuted}>•</text>
            <text fg={theme.text}>
              {req.type === "nodejs" ? "🟢 " : req.type === "python" ? "🐍 " : req.type === "app" ? "📱 " : req.type === "api-key" ? "🔑 " : ""}
              {req.description}
            </text>
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
        // footer renders inside <text> in Option — use <span> elements (NOT <box>)
        footer: (
          <>
            <span style={{ fg: theme.info, attributes: TextAttributes.DIM }}>
              {McpRegistry.categories[entry.category]?.icon ?? ""}{" "}
              {McpRegistry.categories[entry.category]?.label ?? entry.category}
            </span>
            <span style={{ fg: isInstalled ? theme.success : theme.textMuted }}>
              {" "}{isLoading ? "⋯" : isInstalled ? "✓" : isCompatible ? "○" : "✗"}
            </span>
          </>
        ),
        category: entry.category.charAt(0).toUpperCase() + entry.category.slice(1),
        metadata: { entry, isInstalled, isCompatible },
      }
    })
  })

  const keybinds = createMemo(() => [
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
        if (showDetails()) {
          setShowDetails(false)
        } else {
          dialog.clear()
        }
      },
    },
  ])

  const title = createMemo(() => {
    const category = categoryFilter() !== "all" ? ` [${categoryFilter()}]` : ""
    const search = searchQuery() ? ` /${searchQuery()}/` : ""
    return `MCP Registry${category}${search}`
  })

  return (
    <Show
      when={showDetails() && selectedEntry()}
      keyed
      fallback={
        <>
          <box flexDirection="column" gap={1}>
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>
                Enter: Install | D: Details | C: Category | /: Search | Escape: Back
              </text>
            </box>
            <Show when={categoryFilter() !== "all"}>
              <text fg={theme.info}>
                📂 Category: {McpRegistry.categories[categoryFilter() as McpRegistry.Category]?.label}
              </text>
            </Show>
            <Show when={searchQuery()}>
              <text fg={theme.info}>
                🔍 Search: "{searchQuery()}"
              </text>
            </Show>
          </box>
          <DialogSelect
            ref={setRef}
            title={title()}
            options={options()}
            keybind={keybinds()}
            onSelect={async (option) => {
              const entry = McpRegistry.getByName(option.value)
              if (!entry) return

              if (installedMcpNames().has(entry.name)) {
                setSelectedEntry(entry)
                setShowDetails(true)
                return
              }

              setLoading(entry.name)
              try {
                const config = McpRegistry.formatConfig(entry)
                await sdk.client.mcp.add({ name: entry.name, config })

                const status = await sdk.client.mcp.status()
                if (status.data) {
                  sync.set("mcp", status.data)
                }

                setSelectedEntry(entry)
                setShowDetails(true)
              } catch (error) {
                console.error("Failed to install MCP:", error)
              } finally {
                setLoading(null)
              }
            }}
          />
        </>
      }
    >
      {(entry) => {
        const isInstalled = installedMcpNames().has(entry.name)

        useKeyboard(async (evt) => {
          if (evt.name === "return") {
            evt.preventDefault()
            evt.stopPropagation()
            setLoading(entry.name)
            try {
              const config = McpRegistry.formatConfig(entry)
              await sdk.client.mcp.add({ name: entry.name, config })
              const status = await sdk.client.mcp.status()
              if (status.data) {
                sync.set("mcp", status.data)
              }
            } catch (error) {
              console.error("Failed to install MCP:", error)
            } finally {
              setLoading(null)
            }
          }
          if (evt.name === "escape") {
            evt.preventDefault()
            evt.stopPropagation()
            setShowDetails(false)
          }
        })

        return (
          <box flexDirection="column" padding={2} gap={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>{entry.name}</text>
              {entry.featured && <text fg={theme.warning}>⭐ Featured</text>}
            </box>
            <text fg={theme.text}>{entry.description}</text>

            <box flexDirection="row" gap={2}>
              <CategoryBadge category={entry.category} />
              <PlatformIndicator platforms={entry.platform} />
              {entry.stars && (
                <text fg={theme.warning}>★ {entry.stars} stars</text>
              )}
            </box>

            <box marginTop={1}>
              <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>
                Requirements:
              </text>
              <RequirementsList requirements={entry.requirements} />
            </box>

            <box marginTop={1}>
              <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>
                Setup Instructions:
              </text>
              <text fg={theme.text}>{entry.setupInstructions || "No setup instructions available."}</text>
            </box>

            <box marginTop={1}>
              <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>Tags:</text>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <For each={entry.tags}>
                  {(tag) => (
                    <text fg={theme.info}>#{tag}</text>
                  )}
                </For>
              </box>
            </box>

            <box marginTop={2} flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Repository: {entry.repository}</text>
            </box>

            <box marginTop={1}>
              <text fg={theme.textMuted}>
                Press Enter to {isInstalled ? "reinstall" : "install"} | Escape to go back
              </text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
