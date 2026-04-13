import { Button } from "@hopcoderx/ui/button"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"

type AgentEntry = {
  id: string
  name: string
  description?: string
  mode: "subagent" | "primary" | "all" | "orchestrator"
  hidden?: boolean
}

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const agents = createMemo(() => {
    const configAgents = globalSync.data.config.agent ?? {}
    return Object.entries(configAgents).map(([id, agent]) => ({
      id,
      name: (agent as any).name ?? id,
      description: (agent as any).description,
      mode: (agent as any).mode ?? "primary",
      hidden: (agent as any).hidden ?? false,
    })) as AgentEntry[]
  })

  const toggleAgentVisibility = async (agentId: string, agentName: string) => {
    const currentAgents = globalSync.data.config.agent ?? {}
    const agent = currentAgents[agentId]
    if (!agent) return

    const updated = { ...agent, hidden: !agent.hidden }
    globalSync.set("config", "agent", { ...currentAgents, [agentId]: updated })

    await globalSync
      .updateConfig({ agent: { ...currentAgents, [agentId]: updated } })
      .catch((err: unknown) => {
        globalSync.set("config", "agent", currentAgents)
        console.error("Failed to update agent visibility:", err)
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">Agents</h2>
          <p class="text-14-regular text-text-weak">Manage your configured AI agents</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Configured Agents</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={agents().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  No agents configured
                </div>
              }
            >
              <For each={agents()}>
                {(agent) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col min-w-0">
                      <div class="flex items-center gap-3">
                        <span class="text-14-medium text-text-strong truncate">{agent.name}</span>
                        <span class="text-12-regular text-text-weak px-2 py-0.5 rounded bg-surface-stronger-base">{agent.mode}</span>
                        {agent.hidden && <span class="text-12-regular text-text-weak px-2 py-0.5 rounded bg-surface-stronger-base">Hidden</span>}
                      </div>
                      <Show when={agent.description}>
                        <span class="text-12-regular text-text-weak mt-1">{agent.description}</span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        size="large"
                        variant="ghost"
                        onClick={() => void toggleAgentVisibility(agent.id, agent.name)}
                      >
                        {agent.hidden ? "Show" : "Hide"}
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
            Edit agents in your hopcoderx.json config file
          </p>
        </div>
      </div>
    </div>
  )
}
