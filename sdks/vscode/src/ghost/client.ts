import type { GhostConfig } from "./config"

export interface CompletionRequest {
  file: string
  language: string
  prefix: string
  suffix: string
  maxTokens: number
  temperature: number
}

export interface CompletionResponse {
  text: string
}

export class GhostClient {
  private controller: AbortController | undefined
  private endpoint: string
  private hopcoderxPort: number | undefined

  constructor(endpoint: string) {
    this.endpoint = endpoint
  }

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint
  }

  setHopCoderXPort(port: number | undefined) {
    this.hopcoderxPort = port
  }

  cancel() {
    this.controller?.abort()
    this.controller = undefined
  }

  async complete(req: CompletionRequest, token?: { isCancellationRequested: boolean }): Promise<string | undefined> {
    this.cancel()
    this.controller = new AbortController()
    const signal = this.controller.signal

    // Try HopCoderX session API first if a port is available
    if (this.hopcoderxPort) {
      const result = await this.requestHopCoderX(req, signal, token)
      if (result !== undefined) return result
    }

    // Fall back to the configured model endpoint (Ollama-compatible)
    return this.requestOllama(req, signal, token)
  }

  private async requestHopCoderX(
    req: CompletionRequest,
    signal: AbortSignal,
    token?: { isCancellationRequested: boolean },
  ): Promise<string | undefined> {
    try {
      const resp = await fetch(`http://localhost:${this.hopcoderxPort}/ghost/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: req.file,
          language: req.language,
          prefix: req.prefix,
          suffix: req.suffix,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
        }),
        signal,
      })
      if (token?.isCancellationRequested) return undefined
      if (!resp.ok) return undefined
      const body = (await resp.json()) as { completion?: string }
      return body.completion?.trim() || undefined
    } catch {
      return undefined
    }
  }

  private async requestOllama(
    req: CompletionRequest,
    signal: AbortSignal,
    token?: { isCancellationRequested: boolean },
  ): Promise<string | undefined> {
    try {
      const prompt = buildFIMPrompt(req)
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "codellama:7b-code",
          prompt,
          stream: false,
          options: {
            temperature: req.temperature,
            num_predict: req.maxTokens,
            stop: ["\n\n", "<|endoftext|>", "<|file_separator|>"],
          },
        }),
        signal,
      })
      if (token?.isCancellationRequested) return undefined
      if (!resp.ok) return undefined
      const body = (await resp.json()) as { response?: string }
      return body.response?.trim() || undefined
    } catch {
      return undefined
    }
  }
}

function buildFIMPrompt(req: CompletionRequest): string {
  return `<PRE> ${req.prefix} <SUF>${req.suffix} <MID>`
}
