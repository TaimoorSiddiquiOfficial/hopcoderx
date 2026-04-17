import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import type { AssistantMessage } from "@hopcoderx/sdk/v2"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const tokenUsage = createMemo(() => {
    if (route.data.type !== "session") return null
    const messages = sync.data.message[route.data.sessionID] ?? []
    const assistantMsgs = messages.filter((m): m is AssistantMessage => m.role === "assistant")
    if (assistantMsgs.length === 0) return null

    const last = assistantMsgs.at(-1)!
    const totalInput = last.tokens?.input ?? 0
    const totalOutput = last.tokens?.output ?? 0
    const totalUsed = totalInput + totalOutput

    // Find model context limit from providers
    let contextLimit = 0
    for (const provider of sync.data.provider) {
      const model = provider.models[last.modelID]
      if (model?.limit?.context) {
        contextLimit = model.limit.context
        break
      }
    }
    if (!contextLimit) contextLimit = 128_000 // sensible fallback

    const percent = Math.min(100, Math.round((totalUsed / contextLimit) * 100))
    const cost = assistantMsgs.reduce((sum, m) => sum + (m.cost ?? 0), 0)

    return { totalUsed, contextLimit, percent, cost }
  })

  const tokenColor = createMemo(() => {
    const usage = tokenUsage()
    if (!usage) return theme.textMuted
    if (usage.percent >= 90) return theme.error
    if (usage.percent >= 70) return theme.warning
    return theme.success
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={tokenUsage()}>
              {(usage) => (
                <text>
                  <span style={{ fg: tokenColor() }}>◉</span>
                  <span style={{ fg: theme.text }}> {formatTokens(usage().totalUsed)}</span>
                  <span style={{ fg: theme.textMuted }}>/{formatTokens(usage().contextLimit)}</span>
                  <span style={{ fg: tokenColor() }}> {usage().percent}%</span>
                  <Show when={usage().cost > 0}>
                    <span style={{ fg: theme.textMuted }}> ${usage().cost.toFixed(4)}</span>
                  </Show>
                </text>
              )}
            </Show>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}
