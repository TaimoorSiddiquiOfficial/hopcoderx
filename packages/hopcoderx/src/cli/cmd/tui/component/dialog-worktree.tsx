/**
 * B6 – Worktree Panel / Dialog
 *
 * Displays all active git worktrees for the current project, their branch
 * names, and status of any HopCoderX session running inside each one.
 * Accessible from the command palette as "Manage worktrees" (or /worktrees).
 */

import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useKeybind } from "@tui/context/keybind"
import { createResource, createSignal, onMount } from "solid-js"
import path from "path"

export function DialogWorktree() {
  const dialog = useDialog()
  const sdk = useSDK()
  const keybind = useKeybind()

  const [toDelete, setToDelete] = createSignal<string | undefined>()

  const [worktrees, { refetch }] = createResource(async () => {
    const res = await sdk.client.worktree.list({})
    return res.data ?? []
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const options = () =>
    (worktrees() ?? []).map((wt) => {
      const label = (wt as any).name ?? path.basename((wt as any).directory ?? "")
      const branch: string = (wt as any).branch ?? ""
      const dir: string = (wt as any).directory ?? ""
      const isDeleting = toDelete() === dir
      return {
        title: isDeleting ? `Press again to confirm delete` : label,
        value: dir,
        description: isDeleting ? "" : branch,
        footer: dir,
      }
    })

  return (
    <DialogSelect
      title="Worktrees"
      options={options()}
      skipFilter={false}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              setToDelete(undefined)
              await sdk.client.worktree.remove({ directory: option.value })
              await refetch()
              return
            }
            setToDelete(option.value)
          },
        },
      ]}
      onMove={() => setToDelete(undefined)}
      onSelect={() => {
        dialog.clear()
      }}
    />
  )
}
