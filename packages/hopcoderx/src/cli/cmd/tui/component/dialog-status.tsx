import { TextAttributes } from "@opentui/core"
import { fileURLToPath } from "bun"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export type DialogStatusProps = {}

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  const plugins = createMemo(() => {
    const list = sync.data.config.plugin ?? []
    const result = list.map((value) => {
      if (value.startsWith("file://")) {
        const path = fileURLToPath(value)
        const parts = path.split("/")
        const filename = parts.pop() || path
        if (!filename.includes(".")) return { name: filename }
        const basename = filename.split(".")[0]
        if (basename === "index") {
          const dirname = parts.pop()
          const name = dirname || basename
          return { name }
        }
        return { name: basename }
      }
      const index = value.lastIndexOf("@")
      if (index <= 0) return { name: value, version: "latest" }
      const name = value.substring(0, index)
      const version = value.substring(index + 1)
      return { name, version }
    })
    return result.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={Object.keys(sync.data.mcp).length > 0} fallback={<text fg={theme.text}>No MCP Servers</text>}>
        <box>
          <text fg={theme.text}>{Object.keys(sync.data.mcp).length} MCP Servers</text>
          <For each={Object.entries(sync.data.mcp)}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: (
                      {
                        connected: theme.success,
                        failed: theme.error,
                        disabled: theme.textMuted,
                        needs_auth: theme.warning,
                        needs_client_registration: theme.error,
                      } as Record<string, typeof theme.success>
                    )[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{key}</b>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                      <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                      <Match when={(item.status as string) === "needs_auth"}>
                        Needs authentication (run: HopCoderX mcp auth {key})
                      </Match>
                      <Match when={(item.status as string) === "needs_client_registration" && item}>
                        {(val) => (val() as { error: string }).error}
                      </Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      {sync.data.lsp.length > 0 && (
        <box>
          <text fg={theme.text}>{sync.data.lsp.length} LSP Servers</text>
          <For each={sync.data.lsp}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: theme.success,
                      error: theme.error,
                    }[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{item.id}</b> <span style={{ fg: theme.textMuted }}>{item.root}</span>
                </text>
              </box>
            )}
          </For>
        </box>
      )}
      <Show when={enabledFormatters().length > 0} fallback={<text fg={theme.text}>No Formatters</text>}>
        <box>
          <text fg={theme.text}>{enabledFormatters().length} Formatters</text>
          <For each={enabledFormatters()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: theme.success,
                  }}
                >
                  •
                </text>
                <text wrapMode="word" fg={theme.text}>
                  <b>{item.name}</b>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={plugins().length > 0} fallback={<text fg={theme.text}>No Plugins</text>}>
        <box>
          <text fg={theme.text}>{plugins().length} Plugins</text>
          <For each={plugins()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: theme.success,
                  }}
                >
                  •
                </text>
                <text wrapMode="word" fg={theme.text}>
                  <b>{item.name}</b>
                  {item.version && <span style={{ fg: theme.textMuted }}> @{item.version}</span>}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={sync.data.telemetry}>
        {(telem) => (
          <box>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>Performance</text>
            <Show when={telem().slowestTools?.length}>
              <text fg={theme.textMuted}>Slowest tools:</text>
              <For each={telem().slowestTools?.slice(0, 3) ?? []}>
                {(t) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} style={{ fg: t.avgMs > 5000 ? theme.error : t.avgMs > 2000 ? theme.warning : theme.success }}>•</text>
                    <text fg={theme.text}>
                      <b>{t.tool}</b>
                      <span style={{ fg: theme.textMuted }}> avg {formatMs(t.avgMs)} × {t.calls}</span>
                      <Show when={t.errorRate > 0}>
                        <span style={{ fg: theme.error }}> {Math.round(t.errorRate * 100)}% err</span>
                      </Show>
                    </text>
                  </box>
                )}
              </For>
            </Show>
            <Show when={Object.keys(telem().latency ?? {}).length > 0}>
              <text fg={theme.textMuted}>Latency breakdown:</text>
              <For each={Object.entries(telem().latency ?? {})}>
                {([phase, stats]) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} style={{ fg: theme.text }}>•</text>
                    <text fg={theme.text}>
                      <b>{phase}</b>
                      <span style={{ fg: theme.textMuted }}> avg {formatMs(stats.avgMs)} max {formatMs(stats.maxMs)} × {stats.count}</span>
                    </text>
                  </box>
                )}
              </For>
            </Show>
            <text fg={theme.textMuted}>
              {Object.keys(telem().tools ?? {}).length} tools tracked, {telem().sessions?.length ?? 0} active sessions
            </text>
            <Show when={telem().modelPerf?.length}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>Model Performance</text>
              <For each={telem().modelPerf ?? []}>
                {(m) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} style={{ fg: m.errorRate > 0.1 ? theme.error : m.avgTokensPerSec > 50 ? theme.success : theme.warning }}>•</text>
                    <text fg={theme.text}>
                      <b>{m.modelID}</b>
                      <span style={{ fg: theme.textMuted }}> {m.avgTokensPerSec} tok/s avg {formatMs(m.avgLatencyMs)} p95 {formatMs(m.p95LatencyMs)} × {m.invocations}</span>
                      <Show when={m.errors > 0}>
                        <span style={{ fg: theme.error }}> {m.errors} err</span>
                      </Show>
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return (ms / 60_000).toFixed(1) + "m"
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s"
  return Math.round(ms) + "ms"
}