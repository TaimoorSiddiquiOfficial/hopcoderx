import * as vscode from "vscode"

export interface GhostConfig {
  enabled: boolean
  endpoint: string
  debounceMs: number
  maxCacheSize: number
  contextLines: number
  maxTokens: number
  temperature: number
}

const DEFAULTS: GhostConfig = {
  enabled: true,
  endpoint: "http://localhost:11434/api/generate",
  debounceMs: 150,
  maxCacheSize: 256,
  contextLines: 50,
  maxTokens: 128,
  temperature: 0.2,
}

export function read(): GhostConfig {
  const cfg = vscode.workspace.getConfiguration("hopcoderx.ghostCoder")
  return {
    enabled: cfg.get<boolean>("enabled", DEFAULTS.enabled),
    endpoint: cfg.get<string>("endpoint", DEFAULTS.endpoint),
    debounceMs: cfg.get<number>("debounceMs", DEFAULTS.debounceMs),
    maxCacheSize: cfg.get<number>("maxCacheSize", DEFAULTS.maxCacheSize),
    contextLines: cfg.get<number>("contextLines", DEFAULTS.contextLines),
    maxTokens: cfg.get<number>("maxTokens", DEFAULTS.maxTokens),
    temperature: cfg.get<number>("temperature", DEFAULTS.temperature),
  }
}

export function onChange(cb: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("hopcoderx.ghostCoder")) cb()
  })
}
