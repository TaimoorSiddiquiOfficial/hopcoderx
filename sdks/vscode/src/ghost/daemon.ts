import * as vscode from "vscode"
import { GhostClient } from "./client"
import { CompletionCache } from "./cache"
import * as config from "./config"

export class GhostDaemon implements vscode.Disposable {
  private client: GhostClient
  private cache: CompletionCache
  private cfg: config.GhostConfig
  private disposables: vscode.Disposable[] = []
  private prefetchTimer: ReturnType<typeof setTimeout> | undefined
  private enabled: boolean

  constructor() {
    this.cfg = config.read()
    this.client = new GhostClient(this.cfg.endpoint)
    this.cache = new CompletionCache(this.cfg.maxCacheSize)
    this.enabled = this.cfg.enabled

    this.disposables.push(
      config.onChange(() => this.reload()),
      vscode.window.onDidChangeActiveTextEditor(() => this.prefetch()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) this.prefetch()
      }),
    )
  }

  get active() {
    return this.enabled
  }

  toggle() {
    this.enabled = !this.enabled
    if (!this.enabled) {
      this.client.cancel()
      this.cache.clear()
    }
  }

  setHopCoderXPort(port: number | undefined) {
    this.client.setHopCoderXPort(port)
  }

  async complete(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<string | undefined> {
    if (!this.enabled) return undefined

    const prefix = contextBefore(doc, pos, this.cfg.contextLines)
    const suffix = contextAfter(doc, pos, this.cfg.contextLines)
    const file = vscode.workspace.asRelativePath(doc.uri)
    const key = CompletionCache.key(file, pos.line, pos.character, prefix)

    const cached = this.cache.get(key)
    if (cached) return cached

    const result = await this.client.complete(
      {
        file,
        language: doc.languageId,
        prefix,
        suffix,
        maxTokens: this.cfg.maxTokens,
        temperature: this.cfg.temperature,
      },
      token,
    )

    if (result && !token.isCancellationRequested) {
      this.cache.set(key, result)
    }
    return result
  }

  private reload() {
    this.cfg = config.read()
    this.client.setEndpoint(this.cfg.endpoint)
    this.cache.resize(this.cfg.maxCacheSize)
    this.enabled = this.cfg.enabled
  }

  private prefetch() {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer)
    if (!this.enabled) return

    this.prefetchTimer = setTimeout(async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return

      const doc = editor.document
      const pos = editor.selection.active
      const prefix = contextBefore(doc, pos, this.cfg.contextLines)
      const suffix = contextAfter(doc, pos, this.cfg.contextLines)
      const file = vscode.workspace.asRelativePath(doc.uri)
      const key = CompletionCache.key(file, pos.line, pos.character, prefix)

      if (this.cache.get(key)) return

      const result = await this.client.complete(
        {
          file,
          language: doc.languageId,
          prefix,
          suffix,
          maxTokens: this.cfg.maxTokens,
          temperature: this.cfg.temperature,
        },
      )

      if (result) this.cache.set(key, result)
    }, this.cfg.debounceMs * 2)
  }

  dispose() {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer)
    this.client.cancel()
    this.cache.clear()
    this.disposables.forEach((d) => d.dispose())
  }
}

function contextBefore(doc: vscode.TextDocument, pos: vscode.Position, lines: number): string {
  const start = Math.max(0, pos.line - lines)
  const range = new vscode.Range(start, 0, pos.line, pos.character)
  return doc.getText(range)
}

function contextAfter(doc: vscode.TextDocument, pos: vscode.Position, lines: number): string {
  const end = Math.min(doc.lineCount - 1, pos.line + lines)
  const range = new vscode.Range(pos.line, pos.character, end, doc.lineAt(end).text.length)
  return doc.getText(range)
}
