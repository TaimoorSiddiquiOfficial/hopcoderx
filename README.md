<p align="center">
  <a href="https://hopcoder.dev">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="HopCoderX logo">
    </picture>
  </a>
</p>
<p align="center"><strong>The most advanced open-source AI coding agent.</strong></p>
<p align="center">
  <a href="https://hopcoder.dev/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/hopcoderx-ai"><img alt="npm" src="https://img.shields.io/npm/v/hopcoderx-ai?style=flat-square" /></a>
  <a href="https://github.com/TaimoorSiddiquiOfficial/hopcoderx/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/TaimoorSiddiquiOfficial/hopcoderx/publish.yml?style=flat-square&branch=main" /></a>
  <img alt="Languages" src="https://img.shields.io/badge/LSP_languages-117-blue?style=flat-square" />
  <img alt="Tools" src="https://img.shields.io/badge/built--in_tools-42-green?style=flat-square" />
  <img alt="Channels" src="https://img.shields.io/badge/notification_channels-12-orange?style=flat-square" />
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a>
</p>

[![HopCoderX Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://hopcoder.dev)

---

## What is HopCoderX?

HopCoderX is a fully open-source, terminal-first AI coding agent with a client/server architecture. It runs on your machine and can be driven from a TUI, web app, mobile client, or any notification channel. Unlike narrow coding tools, HopCoderX is a full-stack agent platform — with **42 built-in tools**, **17 AI providers**, **12 notification channels**, **5 memory backends**, and **67 CLI commands** — all in **317 TypeScript files** across 64,686 lines of code.

<table>
<tr>
<td align="center"><strong>42</strong><br/>Built-in Tools</td>
<td align="center"><strong>17</strong><br/>AI Providers</td>
<td align="center"><strong>12</strong><br/>Channels</td>
<td align="center"><strong>5</strong><br/>Memory Backends</td>
<td align="center"><strong>67</strong><br/>CLI Commands</td>
<td align="center"><strong>117</strong><br/>LSP Languages</td>
</tr>
</table>

---

## HopCoderX vs OpenClaw — Feature Comparison

> Deep analysis performed April 2026. OpenClaw data from its public repository at the time of comparison.

| Feature | HopCoderX | OpenClaw |
|---|:---:|:---:|
| **AI Providers** | 17 (Anthropic, OpenAI, Google, Copilot, Bedrock, GitLab, Ollama, LM Studio, HuggingFace, NVIDIA NIM, DeepSeek, Fireworks, Cloudflare AI, vLLM, IBM Watsonx, LiteLLM, Venice) | 8 |
| **Notification Channels** | 12 (Discord, Telegram, Teams, WhatsApp, Matrix, Signal, IRC, Mattermost, LINE, Linear, PagerDuty, GitHub Issues) | 4 (Discord, Slack, Telegram, basic webhook) |
| **Built-in Tools** | 42 | ~22 |
| **LSP Languages** | 117 | 30 |
| **Memory Backends** | 5 (SQLite, LanceDB vector, Wiki/Obsidian, Team sync, Dreaming) | 1 (flat file) |
| **Voice Input (STT)** | ✅ Deepgram + Whisper fallback | ❌ |
| **Text-to-Speech** | ✅ ElevenLabs / OpenAI TTS | ❌ |
| **Video Generation** | ✅ Runway Gen-3, Fal.ai Kling | ❌ |
| **Image Generation** | ✅ DALL-E 3, Stable Diffusion | ❌ |
| **Visual Debug (CDP)** | ✅ Screenshot, DOM, network, a11y audit | ❌ |
| **Architecture Diagram** | ✅ Mermaid auto-gen from codebase | ❌ |
| **AI Stack Trace Debug** | ✅ Root cause + fix suggestions | ❌ |
| **Web Search (multi-engine)** | ✅ Tavily, Exa, Firecrawl, built-in | ❌ (1 engine) |
| **Code Vulnerability Scanner** | ✅ OWASP patterns, per-file report | ❌ |
| **SBOM Generator** | ✅ SPDX 2.3 + CycloneDX 1.4 | ❌ |
| **SAML 2.0 SSO + SCIM** | ✅ Enterprise-grade identity | ❌ |
| **Docker/Podman Sandbox** | ✅ Isolated tool execution | ❌ |
| **OTel Tracing** | ✅ In-memory spans + OTLP export | ❌ |
| **Prometheus Metrics** | ✅ `/metrics` endpoint, port 9090 | ❌ |
| **Token Cost Tracker** | ✅ Per-session/model/provider (SQLite) | ❌ |
| **Session Replay** | ✅ Full conversation replay | ❌ |
| **Team Memory Sync** | ✅ Cross-session shared memory | ❌ |
| **Memory Dreaming** | ✅ Background memory consolidation | ❌ |
| **Wiki/Obsidian Memory** | ✅ Markdown vault backend | ❌ |
| **LanceDB Vector Memory** | ✅ Embedding-based semantic search | ❌ |
| **Skills Framework v2** | ✅ Composable skill units | ❌ |
| **Plugin SDK v2** | ✅ Hot-reload, typed API surface | ❌ |
| **HopHub Marketplace** | ✅ Plugin/skill discovery & install | ❌ |
| **Agent Personas** | ✅ Custom agent identity / style | ❌ |
| **Prompt Templates** | ✅ Named reusable prompt library | ❌ |
| **Cron Scheduler** | ✅ Automated recurring agent tasks | ❌ |
| **Daemon Service** | ✅ Background agent process | ❌ |
| **Webhooks** | ✅ Inbound + outbound | ❌ |
| **Tailscale Integration** | ✅ Secure remote access via Tailnet | ❌ |
| **Device QR Pairing** | ✅ Scan to connect mobile/web | ❌ |
| **Git Worktree UI** | ✅ Parallel sessions per worktree | ❌ |
| **TUI Diff Viewer** | ✅ Side-by-side `hopcoderx diff` | ❌ |
| **Semantic Code Search** | ✅ Symbol graph RAG | ❌ |
| **Task Flow Registry** | ✅ Declarative multi-step workflows | ❌ |
| **Dependency Audit** | ✅ CVE/license check | ❌ |
| **Test Generation** | ✅ AI-generated test suites | ❌ |
| **Doc Generation** | ✅ JSDoc/docstring generation | ❌ |
| **Analytics Dashboard** | ✅ Usage trends, model stats | ❌ |
| **Accessibility Audit** | ✅ WCAG checker for web UIs | ❌ |
| **Desktop App** | ✅ macOS / Windows / Linux | ❌ |
| **Open Source** | ✅ MIT | ✅ |

---

## Features

### 🤖 AI Providers (17)

HopCoderX is provider-agnostic. Switch models with one config change or let the failover engine auto-route.

| Provider | Type | Notes |
|---|---|---|
| **Anthropic** | Cloud | Claude 3.5 Sonnet/Haiku/Opus |
| **OpenAI / Codex** | Cloud | GPT-4o, o1, o3, Codex CLI |
| **Google** | Cloud | Gemini 2.0 Flash/Pro |
| **GitHub Copilot** | Cloud | Uses your existing Copilot subscription |
| **AWS Bedrock** | Cloud | Claude, Mistral, Llama via Bedrock |
| **GitLab AI** | Cloud | Duo Pro / Self-managed |
| **Ollama** | Local | Any GGUF/GGML model |
| **LM Studio** | Local | GUI model runner |
| **HuggingFace** | Cloud/Local | Inference API + local transformers |
| **NVIDIA NIM** | Cloud/Local | Optimized inference microservices |
| **DeepSeek** | Cloud | DeepSeek-V3 / R1 |
| **Fireworks AI** | Cloud | Fast inference, OSS models |
| **Cloudflare AI** | Edge | Workers AI — low latency |
| **vLLM** | Self-hosted | OpenAI-compatible server |
| **IBM Watsonx** | Enterprise | Granite + partner models |
| **LiteLLM** | Proxy | Route to 100+ providers via one key |
| **Venice.ai** | Cloud | Privacy-preserving inference |

### 📡 Notification Channels (12)

Connect HopCoderX to your communication platform so agents can send updates and accept commands.

```bash
hopcoderx channels add telegram   # connect Telegram bot
hopcoderx channels add discord    # connect Discord webhook
hopcoderx channels list           # see active channels
```

**Supported:** Discord · Telegram · Microsoft Teams · WhatsApp (Twilio) · Signal · Matrix · IRC · Mattermost · LINE · Linear · PagerDuty · GitHub Issues

### 🛠️ Built-in Tools (42)

#### Code Intelligence
| Tool | Description |
|---|---|
| `lsp` | Language Server Protocol — hover, go-to-definition, references for 117 languages |
| `codesearch` | Ripgrep + AST-based code search |
| `semanticsearch` | Embedding-based semantic code search via symbol graph RAG |
| `codemem` | Store/recall code snippets with context |
| `codevulnscan` | OWASP pattern scanner — detects SQL injection, XSS, hardcoded secrets, etc. |
| `depaudit` | Dependency CVE and license audit |
| `testgen` | AI-generated test suites for any function/module |
| `docgen` | Generate JSDoc / Python docstrings from source |
| `aidebug` | AI-powered stack trace analyzer — root cause + suggested fix |
| `archdiagram` | Auto-generate Mermaid architecture diagrams from codebase |

#### Web & Search
| Tool | Description |
|---|---|
| `websearch` | Built-in web search |
| `webfetch` | Fetch and parse any URL |
| `tavily` | Tavily real-time search API |
| `exa` | Exa neural search API |
| `firecrawl` | FireCrawl structured web scraping |

#### AI Media
| Tool | Description |
|---|---|
| `imagegen` | DALL-E 3 / Stable Diffusion image generation |
| `imageunderstand` | Describe / analyze images |
| `docunderstand` | Parse PDFs, Word docs, spreadsheets |
| `transcribe` | Audio → text (Whisper / Deepgram) |
| `tts` | Text → speech (ElevenLabs / OpenAI TTS) |
| `videogen` | Video generation (Runway Gen-3 / Fal.ai Kling) |
| `voice` | Press-to-talk voice input |
| `visualdebug` | Browser automation — screenshot, DOM inspect, network log, a11y audit via CDP |

#### Core Agent
| Tool | Description |
|---|---|
| `bash` | Execute shell commands |
| `edit` / `multiedit` | File editing (single / multi-hunk) |
| `read` / `write` / `ls` | Filesystem operations |
| `glob` / `grep` | File pattern + content search |
| `apply_patch` | Apply unified diffs |
| `plan` / `todo` | Structured planning and task tracking |
| `task` / `swarm` / `batch` | Spawn parallel subagents |
| `skill` | Invoke marketplace skills |
| `question` | Interactive user prompt |

### 🧠 Memory System (5 Backends)

HopCoderX has a pluggable memory architecture. All backends share the same `MemoryBackend` interface.

| Backend | Storage | Best For |
|---|---|---|
| **SQLite** | Local DB | Default, fast, persistent across sessions |
| **LanceDB** | Local vector store | Semantic / embedding-based recall |
| **Wiki** | Markdown vault | Obsidian-compatible, human-readable notes |
| **Team** | Real-time sync | Shared memory across multiple sessions/users |
| **Dreaming** | Background job | Auto-consolidates memories during idle time |

```bash
hopcoderx memory list              # list all memories
hopcoderx memory search "auth bug" # semantic search
hopcoderx memory export            # export to JSON
```

### 📊 Observability

| Feature | Command / API |
|---|---|
| **OTel tracing** | Set `OTEL_EXPORTER_OTLP_ENDPOINT` for export |
| **Prometheus metrics** | `http://localhost:9090/metrics` |
| **Token cost tracker** | `hopcoderx cost` — per session/model/provider |
| **Session replay** | `hopcoderx replay <session-id>` |
| **Analytics dashboard** | `hopcoderx analytics` |

### 🔐 Security

| Feature | Command |
|---|---|
| **SAML 2.0 SSO + SCIM** | Configure in `auth/saml.ts`, env vars |
| **Code vulnerability scan** | `hopcoderx security scan` |
| **Secrets management** | `hopcoderx secrets set/get/list` |
| **Docker/Podman sandbox** | Auto-detected; used by risky tool calls |
| **Audit logs** | Written to `~/.config/hopcoderx/audit.log` |
| **SBOM generation** | `hopcoderx sbom --format spdx` or `--format cyclonedx` |

---

## Installation

```bash
# YOLO
curl -fsSL https://hopcoder.dev/install | bash

# Package managers
npm i -g hopcoderx-ai@latest        # or bun/pnpm/yarn
scoop install hopcoderx             # Windows
choco install hopcoderx             # Windows
brew install TaimoorSiddiquiOfficial/tap/hopcoderx # macOS and Linux (recommended, always up to date)
brew install hopcoderx              # macOS and Linux (official brew formula, updated less)
sudo pacman -S hopcoderx            # Arch Linux (Stable)
paru -S hopcoderx-bin               # Arch Linux (Latest from AUR)
mise use -g hopcoderx               # Any OS
nix run nixpkgs#hopcoderx           # or github:TaimoorSiddiquiOfficial/hopcoderx for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

HopCoderX is also available as a desktop application. Download directly from the [releases page](https://github.com/TaimoorSiddiquiOfficial/hopcoderx/releases) or [hopcoder.dev/download](https://hopcoder.dev/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `hopcoderx-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `hopcoderx-desktop-darwin-x64.dmg`     |
| Windows               | `hopcoderx-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask hopcoderx-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/hopcoderx-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$HOPCODERX_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.hopcoderx/bin` - Default fallback

```bash
# Examples
HOPCODERX_INSTALL_DIR=/usr/local/bin curl -fsSL https://hopcoder.dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://hopcoder.dev/install | bash
```

---

## Agents

HopCoderX includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

You can create custom agent personas:

```bash
hopcoderx persona create security-expert --style "You are a senior security engineer..."
hopcoderx persona use security-expert
```

Learn more about [agents](https://hopcoder.dev/docs/agents).

---

## Developer SDK & Marketplace

### Plugin SDK v2

Build plugins with the typed HopCoderX Plugin SDK v2. Plugins support hot-reload during development.

```typescript
import type { Plugin } from "@hopcoderx/plugin"

export default ((input) => {
  return {
    async tool(params, next) {
      // intercept or augment any tool call
      return next(params)
    },
  }
}) satisfies Plugin
```

### HopHub Marketplace

Discover and install community plugins, skills, and prompt packs:

```bash
hopcoderx hub search "code review"
hopcoderx hub install hopcoderx-skill-security-audit
hopcoderx hub list
```

---

## Documentation

For more info on how to configure HopCoderX, [**head over to our docs**](https://hopcoder.dev/docs).

---

## Contributing

If you're interested in contributing to HopCoderX, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

---

## Building on HopCoderX

If you are working on a project that's related to HopCoderX and is using "HopCoderX" as part of its name, for example "HopCoderX-dashboard" or "HopCoderX-mobile", please add a note to your README to clarify that it is not built by the HopCoderX team and is not affiliated with us in any way.

---

## FAQ

#### How is this different from Claude Code?

Very similar in core capability, but HopCoderX is broader:

- **100% open source** (MIT)
- **Provider-agnostic** — works with 17 AI providers including local models (Ollama, LM Studio, vLLM)
- **42 built-in tools** vs Claude Code's limited built-ins
- **12 notification channels** — get notified on Telegram, Discord, Teams, WhatsApp, and more
- **Out-of-the-box LSP** for 117 languages — hover, go-to-definition, references in the TUI
- **Client/server architecture** — run HopCoderX headlessly on a server, drive it from mobile or web
- **TUI-first** — built by neovim users; pushes the limits of terminal UI
- **Enterprise features** — SAML SSO, SCIM, SBOM, audit logs, Prometheus metrics, OTel tracing

#### How is this different from OpenClaw?

HopCoderX has significantly more features across every dimension:

- **42 tools** (OpenClaw: ~22) — adds voice, video gen, visual debug, arch diagram, AI stack trace debugger, 5 search engines, and more
- **17 AI providers** (OpenClaw: 8) — adds NVIDIA NIM, IBM Watsonx, LiteLLM, Venice, vLLM, and more
- **12 channels** (OpenClaw: 4) — adds Signal, IRC, Matrix, Mattermost, LINE, Teams, WhatsApp, PagerDuty
- **5 memory backends** (OpenClaw: 1) — LanceDB vector memory, Obsidian wiki, team sync, and dreaming
- **Full observability stack** — OTel tracing, Prometheus metrics, cost tracker (OpenClaw: none)
- **Enterprise security** — SAML SSO, SBOM, Docker sandbox, vulnerability scanner (OpenClaw: none)
- **HopHub marketplace** for plugin/skill discovery (OpenClaw: none)

#### Can I use it with local models?

Yes. HopCoderX supports **Ollama**, **LM Studio**, and **vLLM** for fully offline/local operation. Any OpenAI-compatible endpoint is supported via the LiteLLM provider.

#### Does it work on Windows?

Yes — Windows, macOS, and Linux are all supported. The TUI uses ANSI escape codes that work in Windows Terminal, ConEmu, and most modern terminals.

---

**Join our community** [Discord](https://discord.gg/hopcoderx) | [X.com](https://x.com/hopcoderx)
