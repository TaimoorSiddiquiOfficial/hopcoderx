import { createMemo, createSignal, Show, For } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard } from "@opentui/solid"
import { HubWorkflows } from "@/hub/workflows"
import { HubBundles } from "@/hub/bundles"
import { HubSuggest } from "@/hub/suggest"
import { HubStatus } from "@/hub/status"
import { HubEcosystem } from "@/hub/ecosystem"
import { McpRegistry } from "@/mcp/registry"
import { Instance } from "@/project/instance"

type HubView = "suggested" | "workflows" | "bundles" | "community"

const VIEW_ORDER: HubView[] = ["suggested", "workflows", "bundles", "community"]
const VIEW_LABELS: Record<HubView, string> = {
  suggested: "HopHub \u2014 Suggested Workflows",
  workflows: "HopHub \u2014 All Workflows",
  bundles: "HopHub \u2014 Bundles",
  community: "HopHub \u2014 Community Ecosystem",
}

export function DialogHub() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  dialog.setSize("large")

  const [view, setView] = createSignal<HubView>("suggested")
  const [installing, setInstalling] = createSignal<string | null>(null)
  const [selectedWorkflow, setSelectedWorkflow] = createSignal<HubWorkflows.ResolvedWorkflow | null>(null)
  const [showDetail, setShowDetail] = createSignal(false)

  const installedMcpNames = createMemo(() => new Set(Object.keys(sync.data.mcp ?? {})))
  const suggestions = createMemo(() => HubSuggest.suggest(Instance.directory))

  const workflowOptions = createMemo<DialogSelectOption<string>[]>(() => {
    const installed = installedMcpNames()
    const items = HubWorkflows.listResolved()
    if (view() === "suggested") {
      const suggestedIDs = new Set(suggestions().map((s) => s.workflowID))
      const suggested = items.filter((w) => suggestedIDs.has(w.id))
      const rest = items.filter((w) => !suggestedIDs.has(w.id))
      return buildWorkflowOptions([...suggested, ...rest], installed, suggestions(), theme)
    }
    return buildWorkflowOptions(items, installed, [], theme)
  })

  const bundleOptions = createMemo<DialogSelectOption<string>[]>(() => {
    const installed = installedMcpNames()
    return HubBundles.registry.map((bundle) => {
      const mcpIds = bundle.items.filter((r) => r.kind === "mcp").map((r) => r.id.replace("mcp:", ""))
      const installedCount = mcpIds.filter((name) => installed.has(name)).length
      const total = mcpIds.length
      const cat = bundle.category ?? "bundle"
      return {
        value: bundle.id,
        title: bundle.name,
        description: bundle.description,
        category: cat.charAt(0).toUpperCase() + cat.slice(1),
        footer: `${total} MCPs  ${installedCount}/${total} installed${bundle.recommendedAgent ? "  agent:" + bundle.recommendedAgent : ""}`,
      }
    })
  })

  const communityOptions = createMemo<DialogSelectOption<string>[]>(() => {
    return HubEcosystem.list({ section: "community" }).map((entry) => ({
      value: entry.id,
      title: entry.name,
      description: entry.description,
      category: entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1),
      footer: entry.repository ?? entry.homepage ?? "",
    }))
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const v = view()
    if (v === "bundles") return bundleOptions()
    if (v === "community") return communityOptions()
    return workflowOptions()
  })

  const nextView = createMemo(() => {
    const idx = VIEW_ORDER.indexOf(view())
    return VIEW_ORDER[(idx + 1) % VIEW_ORDER.length]
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("tab")[0],
      title: nextView(),
      onTrigger: () => setView(nextView()),
    },
    {
      keybind: Keybind.parse("d")[0],
      title: "details",
      onTrigger: (option: DialogSelectOption<string>) => {
        if (view() === "workflows" || view() === "suggested") {
          const resolved = HubWorkflows.getResolved(option.value)
          if (resolved) { setSelectedWorkflow(resolved); setShowDetail(true) }
        } else if (view() === "bundles") {
          const workflow = HubWorkflows.registry.find((w) => {
            const preset = HubWorkflows.presetFor(w)
            return preset?.appliesTo.some((rel) => rel.id === option.value)
          })
          if (workflow) {
            const resolved = HubWorkflows.getResolved(workflow.id)
            if (resolved) { setSelectedWorkflow(resolved); setShowDetail(true) }
          }
        }
      },
    },
  ])

  return (
    <Show
      when={showDetail() && selectedWorkflow()}
      keyed
      fallback={
        <>
          <box flexDirection="column" gap={1}>
            <text fg={theme.textMuted}>
              Enter: {view() === "community" ? "Info" : "Install"} | D: Details | Tab: Switch view | Escape: Close
            </text>
            <Show when={view() === "suggested" && suggestions().length > 0}>
              <text fg={theme.info}>
                {`\u2726 ${suggestions().length} workflow${suggestions().length !== 1 ? "s" : ""} detected for this project`}
              </text>
            </Show>
            <Show when={view() === "suggested" && suggestions().length === 0}>
              <text fg={theme.textMuted}>No project signals detected. Press Tab to browse all workflows.</text>
            </Show>
          </box>
          <DialogSelect
            title={VIEW_LABELS[view()]}
            placeholder="Search..."
            options={options()}
            keybind={keybinds()}
            onSelect={async (option) => {
              if (view() === "community") {
                // Show ecosystem entry detail inline
                const entry = HubEcosystem.get(option.value)
                if (!entry) return
                setSelectedWorkflow(null)
                setShowDetail(false)
                // Community entries open their linked workflow detail if available
                if (entry.hubRefs.length > 0) {
                  const workflowRef = entry.hubRefs.find((r) => r.startsWith("workflow:"))
                  if (workflowRef) {
                    const resolved = HubWorkflows.getResolved(workflowRef)
                    if (resolved) { setSelectedWorkflow(resolved); setShowDetail(true) }
                  }
                }
                return
              }
              if (view() === "bundles") {
                const bundle = HubBundles.get(option.value)
                if (!bundle) return
                const workflow = HubWorkflows.registry.find((w) => {
                  const preset = HubWorkflows.presetFor(w)
                  return preset?.appliesTo.some((rel) => rel.id === bundle.id)
                })
                if (workflow) {
                  const resolved = HubWorkflows.getResolved(workflow.id)
                  if (resolved) { setSelectedWorkflow(resolved); setShowDetail(true) }
                }
                return
              }
              const resolved = HubWorkflows.getResolved(option.value)
              if (!resolved) return
              setInstalling(resolved.id)
              try {
                const bundleIDs = resolved.preset?.appliesTo.filter((r) => r.kind === "bundle").map((r) => r.id) ?? []
                for (const bundleID of bundleIDs) {
                  const bundle = HubBundles.get(bundleID)
                  if (!bundle) continue
                  for (const ref of bundle.items.filter((r) => r.kind === "mcp")) {
                    const name = ref.id.replace("mcp:", "")
                    const entry = McpRegistry.getByName(name)
                    if (!entry) continue
                    const hubResolved = HubStatus.resolveMcp(entry, {
                      config: sync.data.config.mcp?.[entry.name] as any,
                      runtime: sync.data.mcp?.[entry.name] as any,
                    })
                    await sdk.client.mcp.add({
                      name: entry.name,
                      config: { ...McpRegistry.formatConfig(entry), enabled: hubResolved.effectiveEnabled },
                    })
                  }
                }
                const status = await sdk.client.mcp.status()
                if (status.data) sync.set("mcp", status.data)
                setSelectedWorkflow(resolved)
                setShowDetail(true)
              } catch (err) {
                console.error("Failed to install workflow:", err)
              } finally {
                setInstalling(null)
              }
            }}
          />
        </>
      }
    >
      {(workflow) => {
        useKeyboard((evt) => {
          if (evt.name === "escape") { evt.preventDefault(); evt.stopPropagation(); setShowDetail(false) }
        })
        return (
          <box flexDirection="column" padding={2} gap={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>{workflow.name}</text>
              <Show when={workflow.recommendedAgent}>
                <text fg={theme.info}>{"agent:" + workflow.recommendedAgent}</text>
              </Show>
            </box>
            <text fg={theme.text}>{workflow.description}</text>
            <Show when={workflow.aliases.length > 0}>
              <text fg={theme.textMuted}>{"Aliases: " + workflow.aliases.join(", ")}</text>
            </Show>
            <Show when={workflow.preset}>
              {(preset) => (
                <box flexDirection="column" marginTop={1} gap={1}>
                  <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>Onboarding steps:</text>
                  <For each={preset().onboarding}>
                    {(step) => (
                      <box flexDirection="column">
                        <text fg={theme.text}>{step.title}</text>
                        <text fg={theme.textMuted}>{step.description}</text>
                        <Show when={step.command}>
                          <text fg={theme.info}>{"  " + step.command}</text>
                        </Show>
                        <Show when={step.envKeys && step.envKeys.length > 0}>
                          <text fg={theme.warning}>{"  Env: " + step.envKeys?.join(", ")}</text>
                        </Show>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </Show>
            <Show when={workflow.starterPrompt}>
              <box marginTop={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>Starter prompt:</text>
                <text fg={theme.text}>{workflow.starterPrompt}</text>
              </box>
            </Show>
            <box marginTop={2}>
              <text fg={theme.textMuted}>Escape to go back</text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildWorkflowOptions(
  items: HubWorkflows.ResolvedWorkflow[],
  installed: Set<string>,
  suggestions: HubSuggest.Suggestion[],
  theme: ReturnType<typeof useTheme>["theme"],
): DialogSelectOption<string>[] {
  const suggestionMap = new Map(suggestions.map((s) => [s.workflowID, s]))
  return items.map((workflow) => {
    const suggestion = suggestionMap.get(workflow.id)
    const bundleMcpIds = workflow.preset?.appliesTo
      .flatMap((rel) => {
        const bundle = HubBundles.get(rel.id)
        return bundle?.items.filter((r) => r.kind === "mcp").map((r) => r.id.replace("mcp:", "")) ?? []
      }) ?? []
    const installedCount = bundleMcpIds.filter((name) => installed.has(name)).length
    const cat = workflow.preset?.category ?? "workflow"
    const suggLabel = suggestion ? "suggested  " : ""
    const agentLabel = workflow.recommendedAgent ? "agent:" + workflow.recommendedAgent : "no-agent"
    const readyLabel = installedCount > 0 ? installedCount + " MCPs ready" : "not installed"
    return {
      value: workflow.id,
      title: (suggestion ? "\u2726 " : "") + workflow.name,
      description: workflow.description,
      category: cat.charAt(0).toUpperCase() + cat.slice(1),
      footer: suggLabel + agentLabel + "  " + readyLabel,
    }
  })
}
