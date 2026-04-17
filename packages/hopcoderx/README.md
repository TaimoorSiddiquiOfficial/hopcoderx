# hopcoderx

Core package for [HopCoderX](https://hopcoder.dev) — the terminal-first AI coding agent.

> For full documentation see the [root README](../../README.md) or [hopcoder.dev](https://hopcoder.dev).

## Installation

```bash
npm i -g hopcoderx-ai@latest   # npm
bun add -g hopcoderx-ai        # bun
brew install TaimoorSiddiquiOfficial/tap/hopcoderx  # macOS/Linux
scoop install hopcoderx        # Windows
```

## Quick Start

```bash
hopcoderx               # open TUI in current directory
hopcoderx "fix the auth bug"   # one-shot prompt
hopcoderx hub           # open HopHub marketplace
```

## Provider Configuration

Configure providers in `~/.config/hopcoderx/config.json` (or `%APPDATA%\hopcoderx\config.json` on Windows):

```json
{
  "provider": {
    "anthropic": { "key": "sk-ant-..." },
    "openai":    { "key": "sk-..." },
    "azure":     {
      "key": "...",
      "options": { "resourceName": "my-resource", "apiVersion": "2024-08-01-preview" }
    },
    "google":    { "key": "AIza..." },
    "ollama":    {},
    "lmstudio":  {}
  }
}
```

### Multi-key Rotation (rate-limit failover)

Supply multiple keys per provider — HopCoderX rotates automatically on 429:

```json
{
  "provider": {
    "openai": { "keys": ["sk-key1", "sk-key2", "sk-key3"] }
  }
}
```

### Supported Providers

| Provider | npm package | Notes |
|---|---|---|
| Anthropic | `@ai-sdk/anthropic` | Claude 3.5/3.7 Sonnet, Haiku, Opus |
| OpenAI | `@ai-sdk/openai` | GPT-4o, o1, o3, Codex |
| Azure OpenAI | `@ai-sdk/azure` | Prompt cache enabled by default |
| Google | `@ai-sdk/google` | Gemini 2.0 Flash/Pro, thinking |
| Google Vertex | `@ai-sdk/google-vertex` | Enterprise Vertex AI |
| AWS Bedrock | `@ai-sdk/amazon-bedrock` | Claude, Mistral, Llama |
| GitLab AI | `@gitlab/gitlab-ai-provider` | Duo Pro / self-managed |
| GitHub Copilot | built-in | Requires Copilot subscription |
| Ollama | `@ai-sdk/openai-compatible` | Auto-discovered at `localhost:11434` |
| LM Studio | `@ai-sdk/openai-compatible` | Auto-discovered at `localhost:1234` |
| LiteLLM | `@ai-sdk/openai-compatible` | Proxy — 100+ providers |
| OpenRouter | `@openrouter/ai-sdk-provider` | Unified API for OSS models |
| DeepSeek | `@ai-sdk/openai-compatible` | DeepSeek-V3, R1 reasoning |
| Groq | `@ai-sdk/groq` | Fast inference |
| Mistral | `@ai-sdk/mistral` | Mistral Large/Codestral |
| xAI | `@ai-sdk/xai` | Grok models |
| Cohere | `@ai-sdk/cohere` | Command R/R+ |
| HopCoderX BDR | built-in | HopCoderX hosted routing |

## Key Commands

```bash
hopcoderx                        # interactive TUI
hopcoderx "prompt"               # one-shot
hopcoderx hub                    # HopHub marketplace
hopcoderx hub suggest            # context-aware bundle suggestions
hopcoderx providers list         # list configured providers
hopcoderx models list            # list all available models
hopcoderx memory list            # list stored memories
hopcoderx memory search "topic"  # semantic memory search
hopcoderx cost                   # token cost tracker
hopcoderx replay <session-id>    # replay a past session
hopcoderx upgrade                # self-update to latest
```

## Keybindings (TUI)

Default keybindings (configurable in `config.json` under the `keybind` key):

| Action | macOS/Linux | Windows |
|---|---|---|
| Submit prompt | `Enter` | `Enter` |
| Newline | `Shift+Enter` | `Shift+Enter` |
| Undo input | `Ctrl+-` / `Super+Z` | `Ctrl+Z` / `Ctrl+-` / `Super+Z` |
| Open HopHub | `<leader>h` (default `Space+h`) | same |
| Suspend terminal | `Ctrl+Z` | *(disabled on Windows)* |
| New session | `Ctrl+N` | same |
| Previous session | `Ctrl+[` | same |
| Next session | `Ctrl+]` | same |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOPCODERX_DISCOVERY_TIMEOUT_MS` | `2000` | Timeout (ms) for local provider model discovery (Ollama, LM Studio, LiteLLM) |
| `HOPCODERX_BDR_TIMEOUT_MS` | `5000` | Timeout (ms) for HopCoderX BDR model list fetch |
| `HOPCODERX_BDR_URL` | `https://api.hopcoder.dev/v1` | Override BDR API base URL |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(unset)* | Enable OpenTelemetry tracing export |

## Development

```bash
# From the repo root
bun install
bun turbo typecheck          # type-check all packages
bun turbo build              # build all packages
cd packages/hopcoderx
bun test                     # run tests
```

## License

MIT © [HopCoderX Contributors](https://github.com/TaimoorSiddiquiOfficial/hopcoderx)
