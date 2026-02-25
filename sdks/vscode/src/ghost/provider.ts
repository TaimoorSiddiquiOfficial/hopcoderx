import * as vscode from "vscode"
import type { GhostDaemon } from "./daemon"

export class GhostCompletionProvider implements vscode.InlineCompletionItemProvider {
  private daemon: GhostDaemon
  private debounceMs: number
  private pending: ReturnType<typeof setTimeout> | undefined

  constructor(daemon: GhostDaemon, debounceMs: number) {
    this.daemon = daemon
    this.debounceMs = debounceMs
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.daemon.active) return undefined

    // Debounce rapid keystrokes
    if (this.pending) clearTimeout(this.pending)
    const wait = await new Promise<boolean>((resolve) => {
      this.pending = setTimeout(() => resolve(true), this.debounceMs)
      token.onCancellationRequested(() => resolve(false))
    })
    if (!wait || token.isCancellationRequested) return undefined

    const text = await this.daemon.complete(document, position, token)
    if (!text || token.isCancellationRequested) return undefined

    return [
      new vscode.InlineCompletionItem(
        text,
        new vscode.Range(position, position),
      ),
    ]
  }
}
