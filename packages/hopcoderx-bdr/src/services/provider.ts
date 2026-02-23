// Multi-provider LLM caller — OpenAI-compatible output for all providers

export type ProviderType = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'workers-ai' | 'azure-openai' | 'cf-ai-gateway'

export interface ProviderConfig {
  id: number
  name: string
  provider: ProviderType
  api_key: string
  base_url?: string | null
  weight: number   // 0-100, used for weighted random within same priority
  priority: number // lower = tried first
}

export interface CallOptions {
  model: string
  messages: any[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
  signal?: AbortSignal
  env?: Record<string, unknown>  // Cloudflare Worker env bindings (for secrets like CLOUDFLARE_GATEWAY_TOKEN)
}

function stripPrefix(provider: ProviderType, modelId: string): string {
  const prefixes: Partial<Record<ProviderType, string[]>> = {
    openai:    ['openai/'],
    anthropic: ['anthropic/'],
    // CF AI Gateway unified uses google/, but some callers send gemini/ — strip both
    gemini:    ['google/', 'gemini/'],
  }
  const ps = prefixes[provider]
  if (!ps) return modelId
  const match = ps.find(p => modelId.startsWith(p))
  return match ? modelId.slice(match.length) : modelId
}

export async function callProvider(config: ProviderConfig, opts: CallOptions): Promise<Response> {
  const model = stripPrefix(config.provider, opts.model)
  const body: Record<string, any> = { model, messages: opts.messages }
  if (opts.max_tokens) body.max_tokens = opts.max_tokens
  if (opts.temperature !== undefined) body.temperature = opts.temperature

  switch (config.provider) {
    case 'openrouter': {
      const url = config.base_url || 'https://openrouter.ai/api/v1/chat/completions'
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api_key}`,
          'HTTP-Referer': 'https://hopcoderx.com',
          'X-Title': 'HopCoderX BDR',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      })
    }

    case 'openai': {
      const url = config.base_url || 'https://api.openai.com/v1/chat/completions'
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.api_key}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      })
    }

    case 'anthropic': {
      const url = config.base_url || 'https://api.anthropic.com/v1/messages'
      const systemMsg = opts.messages.find((m: any) => m.role === 'system')
      const userMsgs = opts.messages.filter((m: any) => m.role !== 'system')
      const aBody: Record<string, any> = { model, messages: userMsgs, max_tokens: opts.max_tokens || 4096 }
      if (systemMsg) aBody.system = systemMsg.content
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.api_key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(aBody),
        signal: opts.signal,
      })
      if (!resp.ok) return resp
      const ar: any = await resp.json()
      return new Response(JSON.stringify({
        id: ar.id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: ar.model,
        choices: [{ index: 0, message: { role: 'assistant', content: ar.content?.[0]?.text || '' }, finish_reason: ar.stop_reason === 'end_turn' ? 'stop' : ar.stop_reason }],
        usage: { prompt_tokens: ar.usage?.input_tokens || 0, completion_tokens: ar.usage?.output_tokens || 0, total_tokens: (ar.usage?.input_tokens || 0) + (ar.usage?.output_tokens || 0) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    case 'gemini': {
      const apiKey = config.api_key
      const url = config.base_url || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const systemMsg = opts.messages.find((m: any) => m.role === 'system')
      const contents = opts.messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      const gBody: Record<string, any> = { contents }
      if (systemMsg) gBody.systemInstruction = { parts: [{ text: systemMsg.content }] }
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gBody), signal: opts.signal })
      if (!resp.ok) return resp
      const gr: any = await resp.json()
      const cand = gr.candidates?.[0]
      return new Response(JSON.stringify({
        id: `gemini-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content: cand?.content?.parts?.[0]?.text || '' }, finish_reason: cand?.finishReason === 'STOP' ? 'stop' : (cand?.finishReason || 'stop') }],
        usage: { prompt_tokens: gr.usageMetadata?.promptTokenCount || 0, completion_tokens: gr.usageMetadata?.candidatesTokenCount || 0, total_tokens: gr.usageMetadata?.totalTokenCount || 0 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    case 'azure-openai': {
      // base_url = https://{resource}.openai.azure.com/openai/deployments/{deployment}
      const url = `${config.base_url}/chat/completions?api-version=2024-02-01`
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': config.api_key },
        body: JSON.stringify(body),
        signal: opts.signal,
      })
    }

    case 'workers-ai': {
      // base_url stores the Cloudflare account_id for Workers AI direct API
      const accountId = config.base_url || ''
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.api_key}` },
        body: JSON.stringify({ messages: opts.messages }),
        signal: opts.signal,
      })
    }

    case 'cf-ai-gateway': {
      // Cloudflare AI Gateway proxy — supports two modes auto-detected from model format:
      //
      // compat mode   — base_url = .../hopcoderx-bdr
      //                 model    = "openai/gpt-4o" (provider prefix required)
      //                 endpoint : {base}/compat/chat/completions
      //
      // provider mode — base_url = .../hopcoderx-bdr/openai  (provider baked in)
      //                 model    = "gpt-5" (plain name)
      //                 endpoint : {base}/chat/completions
      //
      // Auth:
      //   api_key            → Authorization: Bearer  (upstream provider key, "Request headers" option)
      //   CLOUDFLARE_GATEWAY_TOKEN env → cf-aig-authorization (only when gateway auth is enabled)
      const gatewayBase = (config.base_url || '').replace(/\/$/, '')
      if (!gatewayBase) {
        return new Response(JSON.stringify({ error: 'cf-ai-gateway requires base_url (e.g. https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId} or …/{gatewayId}/openai)' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
      // If model has a slash it carries a provider prefix → use /compat endpoint
      const url = opts.model.includes('/')
        ? `${gatewayBase}/compat/chat/completions`
        : `${gatewayBase}/chat/completions`
      const aigBody: Record<string, any> = { ...body, model: opts.model }
      if (opts.stream) aigBody.stream = true
      const aigHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      // Upstream provider key (passed through by CF AI Gateway to the provider)
      if (config.api_key) aigHeaders['Authorization'] = `Bearer ${config.api_key}`
      // Gateway-level auth token (only needed when the CF AI Gateway has authentication enabled)
      const gatewayToken = (opts.env as Record<string, string> | undefined)?.CLOUDFLARE_GATEWAY_TOKEN
      if (gatewayToken) aigHeaders['cf-aig-authorization'] = `Bearer ${gatewayToken}`
      return fetch(url, {
        method: 'POST',
        headers: aigHeaders,
        body: JSON.stringify(aigBody),
        signal: opts.signal,
      })
    }

    default:
      return new Response(JSON.stringify({ error: `Unknown provider type: ${config.provider}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
  }
}
