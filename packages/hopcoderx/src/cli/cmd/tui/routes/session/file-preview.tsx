import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useSplitPane, type PanelTab } from "../../component/split-pane"
import { SplitBorder } from "../../component/border"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import path from "path"

function filetype(input?: string) {
  if (!input) return undefined
  const ext = path.extname(input).slice(1)
  return LANGUAGE_EXTENSIONS[ext] ?? ext
}

export function FilePreview(props: { sessionID: string }) {
  const sync = useSync()
  const { theme, syntax } = useTheme()
  const pane = useSplitPane()

  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const [selected, setSelected] = createSignal<string | undefined>()

  const selectedFile = createMemo(() => {
    const s = selected()
    if (!s) return diff()[0]
    return diff().find((f) => f.file === s) ?? diff()[0]
  })

  const tabs: { id: PanelTab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "diff", label: "Diff" },
  ]

  return (
    <box flexDirection="column" height="100%" paddingLeft={1} paddingRight={1}>
      {/* Tab bar */}
      <box flexDirection="row" flexShrink={0} gap={1} paddingBottom={1}>
        <For each={tabs}>
          {(t) => (
            <text
              onMouseDown={() => pane.setTab(t.id)}
              fg={pane.tab() === t.id ? theme.text : theme.textMuted}
              attributes={pane.tab() === t.id ? TextAttributes.UNDERLINE : TextAttributes.NONE}
            >
              {t.label}
            </text>
          )}
        </For>
        <box flexGrow={1} />
        <text fg={theme.textMuted} onMouseDown={() => pane.toggle()}>
          ✕
        </text>
      </box>

      <Switch>
        {/* Files tab — tree of changed files */}
        <Match when={pane.tab() === "files"}>
          <scrollbox flexGrow={1}>
            <Show
              when={diff().length > 0}
              fallback={<text fg={theme.textMuted}>No changes yet</text>}
            >
              <For each={diff()}>
                {(item) => {
                  const active = createMemo(() => selectedFile()?.file === item.file)
                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      justifyContent="space-between"
                      onMouseDown={() => {
                        setSelected(item.file)
                        pane.setTab("diff")
                      }}
                      backgroundColor={active() ? theme.backgroundElement : undefined}
                    >
                      <text fg={active() ? theme.text : theme.textMuted} wrapMode="none">
                        {statusIcon(item.status)} {item.file}
                      </text>
                      <box flexDirection="row" gap={1} flexShrink={0}>
                        <Show when={item.additions > 0}>
                          <text fg={theme.diffAdded}>+{item.additions}</text>
                        </Show>
                        <Show when={item.deletions > 0}>
                          <text fg={theme.diffRemoved}>-{item.deletions}</text>
                        </Show>
                      </box>
                    </box>
                  )
                }}
              </For>
            </Show>
          </scrollbox>
        </Match>

        {/* Diff tab — diff for selected file */}
        <Match when={pane.tab() === "diff"}>
          <Show when={selectedFile()} fallback={<text fg={theme.textMuted}>Select a file to preview</text>}>
            {(file) => {
              const unified = createMemo(() => {
                const f = file()
                if (!f.before && f.after) return formatAdd(f.after)
                if (f.before && !f.after) return formatDelete(f.before)
                return formatUnified(f.before, f.after)
              })
              const ft = createMemo(() => filetype(file().file))

              return (
                <box flexDirection="column" flexGrow={1}>
                  <box flexShrink={0} paddingBottom={1}>
                    <text
                      fg={theme.textMuted}
                      onMouseDown={() => pane.setTab("files")}
                    >
                      ← {file().file}
                    </text>
                  </box>
                  <scrollbox flexGrow={1}>
                    <diff
                      diff={unified()}
                      view="unified"
                      filetype={ft()}
                      syntaxStyle={syntax()}
                      showLineNumbers={true}
                      width={pane.rightWidth() - 4}
                      addedBg={theme.diffAddedBg}
                      removedBg={theme.diffRemovedBg}
                      contextBg={theme.diffContextBg}
                      addedSignColor={theme.diffHighlightAdded}
                      removedSignColor={theme.diffHighlightRemoved}
                      lineNumberFg={theme.diffLineNumber}
                      lineNumberBg={theme.diffContextBg}
                      addedLineNumberBg={theme.diffAddedLineNumberBg}
                      removedLineNumberBg={theme.diffRemovedLineNumberBg}
                    />
                  </scrollbox>
                </box>
              )
            }}
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

function statusIcon(status?: string) {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

function formatAdd(content: string) {
  return content
    .split("\n")
    .map((l) => `+${l}`)
    .join("\n")
}

function formatDelete(content: string) {
  return content
    .split("\n")
    .map((l) => `-${l}`)
    .join("\n")
}

function formatUnified(before: string, after: string) {
  const a = before.split("\n")
  const b = after.split("\n")
  const lines: string[] = []
  const max = Math.max(a.length, b.length)
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i]}`)
      i++
      j++
      continue
    }
    if (i < a.length) {
      lines.push(`-${a[i]}`)
      i++
      continue
    }
    if (j < b.length) {
      lines.push(`+${b[j]}`)
      j++
    }
  }
  return lines.join("\n")
}
