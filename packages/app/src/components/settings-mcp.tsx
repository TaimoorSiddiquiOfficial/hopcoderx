import { Button } from "@hopcoderx/ui/button"
import { showToast } from "@hopcoderx/ui/toast"
import { createMemo, type Component, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"

type McpEntry = {
  id: string
  type: "local" | "remote" | "disabled"
  url?: string
  command?: string[]
  disabled?: boolean
}

export const SettingsMcp: Component = () => {
  const globalSync = useGlobalSync()

  const mcpServers = createMemo(() => {
    const configMcp = globalSync.data.config.mcp ?? {}
    return Object.entries(configMcp).map(([id, server]) => {
      const srv = server as any
      return {
        id,
        type: srv.disabled ? "disabled" : (srv.type ?? "local"),
        url: srv.url,
        command: srv.command,
        disabled: srv.disabled ?? false,
      } as McpEntry
    })
  })

  const toggleServer = async (serverId: string, serverName: string, currentlyDisabled: boolean) => {
    const currentMcp = globalSync.data.config.mcp ?? {}
    const server = currentMcp[serverId]
    if (!server) return

    const updated = { ...server, disabled: !currentlyDisabled }
    globalSync.set("config", "mcp", { ...currentMcp, [serverId]: updated })

    await globalSync
      .updateConfig({ mcp: { ...currentMcp, [serverId]: updated } })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: `Server "${serverName}" ${!currentlyDisabled ? "Enabled" : "Disabled"}`,
          description: `The MCP server "${serverName}" has been ${!currentlyDisabled ? "enabled" : "disabled"}.`,
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "mcp", currentMcp)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: "Request Failed", description: message })
      })
  }

  const removeServer = async (serverId: string, serverName: string) => {
    const currentMcp = globalSync.data.config.mcp ?? {}
    const updated = { ...currentMcp }
    delete updated[serverId]

    globalSync.set("config", "mcp", updated)

    await globalSync
      .updateConfig({ mcp: updated })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: `Server "${serverName}" Removed`,
          description: `The MCP server "${serverName}" has been removed from your configuration.`,
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "mcp", currentMcp)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: "Request Failed", description: message })
      })
  }

  const typeLabel = (type: string) => {
    switch (type) {
      case "local":
        return "Local"
      case "remote":
        return "Remote"
      case "disabled":
        return "Disabled"
      default:
        return type
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">MCP Servers</h2>
          <p class="text-14-regular text-text-weak">Manage your Model Context Protocol servers</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Configured Servers</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={mcpServers().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  No MCP servers configured
                </div>
              }
            >
              <For each={mcpServers()}>
                {(server) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col min-w-0 flex-1">
                      <div class="flex items-center gap-3">
                        <span class="text-14-medium text-text-strong truncate">{server.id}</span>
                        <span class="text-12-regular text-text-weak px-2 py-0.5 rounded bg-surface-stronger-base">{typeLabel(server.type)}</span>
                        {server.disabled && <span class="text-12-regular text-text-weak px-2 py-0.5 rounded bg-surface-stronger-base">Disabled</span>}
                      </div>
                      <Show when={server.url}>
                        <code class="text-12-regular text-code-base mt-1">{server.url}</code>
                      </Show>
                      <Show when={server.command}>
                        <code class="text-12-regular text-code-base mt-1">{server.command?.join(" ")}</code>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="large"
                        variant="ghost"
                        onClick={() => void toggleServer(server.id, server.id, server.disabled ?? false)}
                      >
                        {server.disabled ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        size="large"
                        variant="ghost"
                        onClick={() => void removeServer(server.id, server.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-14-regular text-text-weak">
            Edit MCP servers in your hopcoderx.json config file
          </p>
        </div>
      </div>
    </div>
  )
}
