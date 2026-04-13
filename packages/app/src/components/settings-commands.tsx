import { Button } from "@hopcoderx/ui/button"
import { Tag } from "@hopcoderx/ui/tag"
import { showToast } from "@hopcoderx/ui/toast"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

type CommandEntry = {
  id: string
  name: string
  description?: string
  agent?: string
  command: string
  arguments?: string[]
}

export const SettingsCommands: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const commands = createMemo(() => {
    const configCommands = globalSync.data.config.command ?? {}
    return Object.entries(configCommands).map(([id, cmd]) => ({
      id,
      name: (cmd as any).name ?? id,
      description: (cmd as any).description,
      agent: (cmd as any).agent,
      command: (cmd as any).command ?? "",
      arguments: (cmd as any).arguments ?? [],
    })) as CommandEntry[]
  })

  const deleteCommand = async (commandId: string, commandName: string) => {
    const currentCommands = globalSync.data.config.command ?? {}
    const updated = { ...currentCommands }
    delete updated[commandId]

    globalSync.set("config", "command", updated)

    await globalSync
      .updateConfig({ command: updated })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("command.delete.toast.deleted.title", { command: commandName }),
          description: language.t("command.delete.toast.deleted.description", { command: commandName }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "command", currentCommands)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.commands.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.commands.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.commands.section.configured")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={commands().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.commands.empty")}
                </div>
              }
            >
              <For each={commands()}>
                {(command) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex flex-col min-w-0 flex-1">
                      <div class="flex items-center gap-3">
                        <span class="text-14-medium text-text-strong truncate">{command.name}</span>
                        <Show when={command.agent}>
                          <Tag variant="secondary">{command.agent}</Tag>
                        </Show>
                      </div>
                      <Show when={command.description}>
                        <span class="text-12-regular text-text-weak mt-1">{command.description}</span>
                      </Show>
                      <Show when={command.command}>
                        <code class="text-12-regular text-code-base mt-1 bg-surface-stronger-base px-2 py-0.5 rounded">
                          {command.command}{" "}
                          {command.arguments?.join(" ")}
                        </code>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="large"
                        variant="ghost"
                        onClick={() => void deleteCommand(command.id, command.name)}
                      >
                        {language.t("common.delete")}
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
            {language.t("settings.commands.hint")}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              globalSDK.client.global.openConfigFile({ section: "command" }).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err)
                showToast({ title: language.t("common.requestFailed"), description: message })
              })
            }}
          >
            {language.t("settings.commands.editInConfig")}
          </Button>
        </div>
      </div>
    </div>
  )
}
