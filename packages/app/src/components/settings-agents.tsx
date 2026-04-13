import { Button } from "@hopcoderx/ui/button"
import { Tag } from "@hopcoderx/ui/tag"
import { showToast } from "@hopcoderx/ui/toast"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

type AgentEntry = {
  id: string
  name: string
  description?: string
  mode: "subagent" | "primary" | "all" | "orchestrator"
  hidden?: boolean
  color?: string
}

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const agents = createMemo(() => {
    const configAgents = globalSync.data.config.agent ?? {}
    return Object.entries(configAgents).map(([id, agent]) => ({
      id,
      name: (agent as any).name ?? id,
      description: (agent as any).description,
      mode: (agent as any).mode ?? "primary",
      hidden: (agent as any).hidden ?? false,
      color: (agent as any).color,
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
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("agent.visibility.toast.updated.title", { agent: agentName }),
          description: language.t("agent.visibility.toast.updated.description", {
            agent: agentName,
            status: updated.hidden ? language.t("common.hidden") : language.t("common.visible"),
          }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "agent", currentAgents)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const modeLabel = (mode: string) => {
    switch (mode) {
      case "primary":
        return language.t("agent.mode.primary")
      case "subagent":
        return language.t("agent.mode.subagent")
      case "all":
        return language.t("agent.mode.all")
      case "orchestrator":
        return language.t("agent.mode.orchestrator")
      default:
        return mode
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.agents.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.agents.section.configured")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={agents().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.agents.empty")}
                </div>
              }
            >
              <For each={agents()}>
                {(agent) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col min-w-0">
                      <div class="flex items-center gap-3">
                        <span class="text-14-medium text-text-strong truncate">{agent.name}</span>
                        <Tag>{modeLabel(agent.mode)}</Tag>
                        {agent.hidden && <Tag variant="secondary">{language.t("common.hidden")}</Tag>}
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
                        {agent.hidden ? language.t("common.show") : language.t("common.hide")}
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
            {language.t("settings.agents.hint")}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              globalSDK.client.global.openConfigFile({ section: "agent" }).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err)
                showToast({ title: language.t("common.requestFailed"), description: message })
              })
            }}
          >
            {language.t("settings.agents.editInConfig")}
          </Button>
        </div>
      </div>
    </div>
  )
}
