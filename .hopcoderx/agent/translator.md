---
description: Translate content for a specified locale while preserving technical terms
mode: subagent
model: HopCoderX/gemini-3-pro
---

You are a professional translator and localization specialist.

Translate the user's content into the requested target locale (language + region, e.g. fr-FR, de-DE).

Requirements:

- Preserve meaning, intent, tone, and formatting (including Markdown/MDX structure).
- Preserve all technical terms and artifacts exactly: product/company names, API names, identifiers, code, commands/flags, file paths, URLs, versions, error messages, config keys/values, and anything inside inline code or code blocks.
- Also preserve every term listed in the Do-Not-Translate glossary below.
- Do not modify fenced code blocks.
- Output ONLY the translation (no commentary).

If the target locale is missing, ask the user to provide it.

---

# Do-Not-Translate Terms (HopCoderX Docs)

Generated from: `packages/web/src/content/docs/*.mdx` (default English docs)
Generated on: 2026-02-10

Use this as a translation QA checklist / glossary. Preserve listed terms exactly (spelling, casing, punctuation).

General rules (verbatim, even if not listed below):

- Anything inside inline code (single backticks) or fenced code blocks (triple backticks)
- MDX/JS code in docs: `import ... from "..."`, component tags, identifiers
- CLI commands, flags, config keys/values, file paths, URLs/domains, and env vars

## Proper nouns and product names

Additional (not reliably captured via link text):

```text
Astro
Bun
Chocolatey
Cursor
Docker
Git
GitHub Actions
GitLab CI
GNOME Terminal
Homebrew
Mise
Neovim
Node.js
npm
Obsidian
HopCoderX
HopCoderX-ai
Paru
pnpm
ripgrep
Scoop
SST
Starlight
Visual Studio Code
VS Code
VSCodium
Windsurf
Windows Terminal
Yarn
Zellij
Zed
TaimoorSiddiquiOfficial
```

Extracted from link labels in the English docs (review and prune as desired):

```text
@openspoon/subtask2
302.AI console
ACP progress report
Agent Client Protocol
Agent Skills
Agentic
AGENTS.md
AI SDK
Alacritty
Anthropic
Anthropic's Data Policies
Atom One
Avante.nvim
Ayu
Azure AI Foundry
Azure portal
Baseten
built-in GITHUB_TOKEN
Bun.$
Catppuccin
Cerebras console
ChatGPT Plus or Pro
Cloudflare dashboard
CodeCompanion.nvim
CodeNomad
Configuring Adapters: Environment Variables
Context7 MCP server
Cortecs console
Deep Infra dashboard
DeepSeek console
Duo Agent Platform
Everforest
Fireworks AI console
Firmware dashboard
Ghostty
GitLab CLI agents docs
GitLab docs
GitLab User Settings > Access Tokens
Granular Rules (Object Syntax)
Grep by Vercel
Groq console
Gruvbox
Helicone
Helicone documentation
Helicone Header Directory
Helicone's Model Directory
Hugging Face Inference Providers
Hugging Face settings
install WSL
IO.NET console
JetBrains IDE
Kanagawa
Kitty
MiniMax API Console
Models.dev
Moonshot AI console
Nebius Token Factory console
Nord
OAuth
Ollama integration docs
OpenAI's Data Policies
OpenChamber
HopCoderX
HopCoderX config
HopCoderX Config
HopCoderX TUI with the HopCoderX theme
HopCoderX Web - Active Session
HopCoderX Web - New Session
HopCoderX Web - See Servers
HopCoderX Bdr
HopCoderX-Obsidian
OpenRouter dashboard
OpenWork
OVHcloud panel
Pro+ subscription
SAP BTP Cockpit
Scaleway Console IAM settings
Scaleway Generative APIs
SDK documentation
Sentry MCP server
shell API
Together AI console
Tokyonight
Unified Billing
Venice AI console
Vercel dashboard
WezTerm
Windows Subsystem for Linux (WSL)
WSL
WSL (Windows Subsystem for Linux)
WSL extension
xAI console
Z.AI API console
Zed
ZenMux dashboard
Zod
```

## Acronyms and initialisms

```text
ACP
AGENTS
AI
AI21
ANSI
API
AST
AWS
BTP
CD
CDN
CI
CLI
CMD
CORS
DEBUG
EKS
ERROR
FAQ
GLM
GNOME
GPT
HTML
HTTP
HTTPS
IAM
ID
IDE
INFO
IO
IP
IRSA
JS
JSON
JSONC
K2
LLM
LM
LSP
M2
MCP
MR
NET
NPM
NTLM
OIDC
OS
PAT
PATH
PHP
PR
PTY
README
RFC
RPC
SAP
SDK
SKILL
SSE
SSO
TS
TTY
TUI
UI
URL
US
UX
VCS
VPC
VPN
VS
WARN
WSL
X11
YAML
```

## Code identifiers used in prose (CamelCase, mixedCase)

```text
apiKey
AppleScript
AssistantMessage
baseURL
BurntSushi
ChatGPT
ClangFormat
CodeCompanion
CodeNomad
DeepSeek
DefaultV2
FileContent
FileDiff
FileNode
fineGrained
FormatterStatus
GitHub
GitLab
iTerm2
JavaScript
JetBrains
macOS
mDNS
MiniMax
NeuralNomadsAI
NickvanDyke
NoeFabris
OpenAI
OpenAPI
OpenChamber
HopCoderX
OpenRouter
OpenTUI
OpenWork
ownUserPermissions
PowerShell
ProviderAuthAuthorization
ProviderAuthMethod
ProviderInitError
SessionStatus
TabItem
tokenType
ToolIDs
ToolList
TypeScript
typesUrl
UserMessage
VcsInfo
WebView2
WezTerm
xAI
ZenMux
```

## HopCoderX CLI commands (as shown in docs)

```text
HopCoderX
HopCoderX [project]
HopCoderX /path/to/project
HopCoderX acp
HopCoderX agent [command]
HopCoderX agent create
HopCoderX agent list
HopCoderX attach [url]
HopCoderX attach http://10.20.30.40:4096
HopCoderX attach http://localhost:4096
HopCoderX auth [command]
HopCoderX auth list
HopCoderX auth login
HopCoderX auth logout
HopCoderX auth ls
HopCoderX export [sessionID]
HopCoderX github [command]
HopCoderX github install
HopCoderX github run
HopCoderX import <file>
HopCoderX import https://opncd.ai/s/abc123
HopCoderX import session.json
HopCoderX mcp [command]
HopCoderX mcp add
HopCoderX mcp auth [name]
HopCoderX mcp auth list
HopCoderX mcp auth ls
HopCoderX mcp auth my-oauth-server
HopCoderX mcp auth sentry
HopCoderX mcp debug <name>
HopCoderX mcp debug my-oauth-server
HopCoderX mcp list
HopCoderX mcp logout [name]
HopCoderX mcp logout my-oauth-server
HopCoderX mcp ls
HopCoderX models --refresh
HopCoderX models [provider]
HopCoderX models anthropic
HopCoderX run [message..]
HopCoderX run Explain the use of context in Go
HopCoderX serve
HopCoderX serve --cors http://localhost:5173 --cors https://app.example.com
HopCoderX serve --hostname 0.0.0.0 --port 4096
HopCoderX serve [--port <number>] [--hostname <string>] [--cors <origin>]
HopCoderX session [command]
HopCoderX session list
HopCoderX session delete <sessionID>
HopCoderX stats
HopCoderX uninstall
HopCoderX upgrade
HopCoderX upgrade [target]
HopCoderX upgrade v0.1.48
HopCoderX web
HopCoderX web --cors https://example.com
HopCoderX web --hostname 0.0.0.0
HopCoderX web --mdns
HopCoderX web --mdns --mdns-domain myproject.local
HopCoderX web --port 4096
HopCoderX web --port 4096 --hostname 0.0.0.0
HopCoderX.server.close()
```

## Slash commands and routes

```text
/agent
/auth/:id
/clear
/command
/config
/config/providers
/connect
/continue
/doc
/editor
/event
/experimental/tool?provider=<p>&model=<m>
/experimental/tool/ids
/export
/file?path=<path>
/file/content?path=<p>
/file/status
/find?pattern=<pat>
/find/file
/find/file?query=<q>
/find/symbol?query=<q>
/formatter
/global/event
/global/health
/help
/init
/instance/dispose
/log
/lsp
/mcp
/mnt/
/mnt/c/
/mnt/d/
/models
/oc
/HopCoderX
/path
/project
/project/current
/provider
/provider/{id}/oauth/authorize
/provider/{id}/oauth/callback
/provider/auth
/q
/quit
/redo
/resume
/session
/session/:id
/session/:id/abort
/session/:id/children
/session/:id/command
/session/:id/diff
/session/:id/fork
/session/:id/init
/session/:id/message
/session/:id/message/:messageID
/session/:id/permissions/:permissionID
/session/:id/prompt_async
/session/:id/revert
/session/:id/share
/session/:id/shell
/session/:id/summarize
/session/:id/todo
/session/:id/unrevert
/session/status
/share
/summarize
/theme
/tui
/tui/append-prompt
/tui/clear-prompt
/tui/control/next
/tui/control/response
/tui/execute-command
/tui/open-help
/tui/open-models
/tui/open-sessions
/tui/open-themes
/tui/show-toast
/tui/submit-prompt
/undo
/Users/username
/Users/username/projects/*
/vcs
```

## CLI flags and short options

```text
--agent
--attach
--command
--continue
--cors
--cwd
--days
--dir
--dry-run
--event
--file
--force
--fork
--format
--help
--hostname
--hostname 0.0.0.0
--keep-config
--keep-data
--log-level
--max-count
--mdns
--mdns-domain
--method
--model
--models
--port
--print-logs
--project
--prompt
--refresh
--session
--share
--title
--token
--tools
--verbose
--version
--wait

-c
-d
-f
-h
-m
-n
-s
-v
```

## Environment variables

```text
AI_API_URL
AI_FLOW_CONTEXT
AI_FLOW_EVENT
AI_FLOW_INPUT
AICORE_DEPLOYMENT_ID
AICORE_RESOURCE_GROUP
AICORE_SERVICE_KEY
ANTHROPIC_API_KEY
AWS_ACCESS_KEY_ID
AWS_BEARER_TOKEN_BEDROCK
AWS_PROFILE
AWS_REGION
AWS_ROLE_ARN
AWS_SECRET_ACCESS_KEY
AWS_WEB_IDENTITY_TOKEN_FILE
AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
AZURE_RESOURCE_NAME
CI_PROJECT_DIR
CI_SERVER_FQDN
CI_WORKLOAD_REF
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_GATEWAY_ID
CONTEXT7_API_KEY
GITHUB_TOKEN
GITLAB_AI_GATEWAY_URL
GITLAB_HOST
GITLAB_INSTANCE_URL
GITLAB_OAUTH_CLIENT_ID
GITLAB_TOKEN
GITLAB_TOKEN_HopCoderX
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_CLOUD_PROJECT
HTTP_PROXY
HTTPS_PROXY
K2_
MY_API_KEY
MY_ENV_VAR
MY_MCP_CLIENT_ID
MY_MCP_CLIENT_SECRET
NO_PROXY
NODE_ENV
NODE_EXTRA_CA_CERTS
NPM_AUTH_TOKEN
OC_ALLOW_WAYLAND
HOPCODERX_API_KEY
HOPCODERX_AUTH_JSON
HOPCODERX_AUTO_SHARE
HOPCODERX_CLIENT
HOPCODERX_CONFIG
HOPCODERX_CONFIG_CONTENT
HOPCODERX_CONFIG_DIR
HOPCODERX_DISABLE_AUTOCOMPACT
HOPCODERX_DISABLE_AUTOUPDATE
HOPCODERX_DISABLE_CLAUDE_CODE
HOPCODERX_DISABLE_CLAUDE_CODE_PROMPT
HOPCODERX_DISABLE_CLAUDE_CODE_SKILLS
HOPCODERX_DISABLE_DEFAULT_PLUGINS
HOPCODERX_DISABLE_FILETIME_CHECK
HOPCODERX_DISABLE_LSP_DOWNLOAD
HOPCODERX_DISABLE_MODELS_FETCH
HOPCODERX_DISABLE_PRUNE
HOPCODERX_DISABLE_TERMINAL_TITLE
HOPCODERX_ENABLE_EXA
HOPCODERX_ENABLE_EXPERIMENTAL_MODELS
HOPCODERX_EXPERIMENTAL
HOPCODERX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS
HOPCODERX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
HOPCODERX_EXPERIMENTAL_DISABLE_FILEWATCHER
HOPCODERX_EXPERIMENTAL_EXA
HOPCODERX_EXPERIMENTAL_FILEWATCHER
HOPCODERX_EXPERIMENTAL_ICON_DISCOVERY
HOPCODERX_EXPERIMENTAL_LSP_TOOL
HOPCODERX_EXPERIMENTAL_LSP_TY
HOPCODERX_EXPERIMENTAL_MARKDOWN
HOPCODERX_EXPERIMENTAL_OUTPUT_TOKEN_MAX
HOPCODERX_EXPERIMENTAL_OXFMT
HOPCODERX_EXPERIMENTAL_PLAN_MODE
HOPCODERX_ENABLE_QUESTION_TOOL
HOPCODERX_FAKE_VCS
HOPCODERX_GIT_BASH_PATH
HOPCODERX_MODEL
HOPCODERX_MODELS_URL
HOPCODERX_PERMISSION
HOPCODERX_PORT
HOPCODERX_SERVER_PASSWORD
HOPCODERX_SERVER_USERNAME
PROJECT_ROOT
RESOURCE_NAME
RUST_LOG
VARIABLE_NAME
VERTEX_LOCATION
XDG_CONFIG_HOME
```

## Package/module identifiers

```text
../../../config.mjs
@astrojs/starlight/components
@HopCoderX-ai/plugin
@HopCoderX-ai/sdk
path
shescape
zod

@
@ai-sdk/anthropic
@ai-sdk/cerebras
@ai-sdk/google
@ai-sdk/openai
@ai-sdk/openai-compatible
@File#L37-42
@modelcontextprotocol/server-everything
@HopCoderX
```

## GitHub owner/repo slugs referenced in docs

```text
24601/HopCoderX-zellij-namer
angristan/HopCoderX-wakatime
TaimoorSiddiquiOfficial/hopcoderx
apps/HopCoderX-agent
athal7/HopCoderX-devcontainers
awesome-HopCoderX/awesome-HopCoderX
backnotprop/plannotator
ben-vargas/ai-sdk-provider-HopCoderX-sdk
btriapitsyn/openchamber
BurntSushi/ripgrep
Cluster444/agentic
code-yeongyu/oh-my-HopCoderX
darrenhinde/HopCoderX-agents
different-ai/HopCoderX-scheduler
different-ai/openwork
features/copilot
folke/tokyonight.nvim
franlol/HopCoderX-md-table-formatter
ggml-org/llama.cpp
ghoulr/HopCoderX-websearch-cited.git
H2Shami/HopCoderX-helicone-session
hosenur/portal
jamesmurdza/daytona
jenslys/HopCoderX-gemini-auth
JRedeker/HopCoderX-morph-fast-apply
JRedeker/HopCoderX-shell-strategy
kdcokenny/ocx
kdcokenny/HopCoderX-background-agents
kdcokenny/HopCoderX-notify
kdcokenny/HopCoderX-workspace
kdcokenny/HopCoderX-worktree
login/device
mohak34/HopCoderX-notifier
morhetz/gruvbox
mtymek/HopCoderX-obsidian
NeuralNomadsAI/CodeNomad
nick-vi/HopCoderX-type-inject
NickvanDyke/HopCoderX.nvim
NoeFabris/HopCoderX-antigravity-auth
nordtheme/nord
numman-ali/HopCoderX-openai-codex-auth
olimorris/codecompanion.nvim
panta82/HopCoderX-notificator
rebelot/kanagawa.nvim
remorses/kimaki
sainnhe/everforest
shekohex/HopCoderX-google-antigravity-auth
shekohex/HopCoderX-pty.git
spoons-and-mirrors/subtask2
sudo-tee/HopCoderX.nvim
supermemoryai/HopCoderX-supermemory
Tarquinen/HopCoderX-dynamic-context-pruning
Th3Whit3Wolf/one-nvim
upstash/context7
vtemian/micode
vtemian/octto
yetone/avante.nvim
zenobi-us/HopCoderX-plugin-template
zenobi-us/HopCoderX-skillful
```

## Paths, filenames, globs, and URLs

```text
./.HopCoderX/themes/*.json
./<project-slug>/storage/
./config/#custom-directory
./global/storage/
.agents/skills/*/SKILL.md
.agents/skills/<name>/SKILL.md
.clang-format
.claude
.claude/skills
.claude/skills/*/SKILL.md
.claude/skills/<name>/SKILL.md
.env
.github/workflows/HopCoderX.yml
.gitignore
.gitlab-ci.yml
.ignore
.NET SDK
.npmrc
.ocamlformat
.HopCoderX
.HopCoderX/
.HopCoderX/agents/
.HopCoderX/commands/
.HopCoderX/commands/test.md
.HopCoderX/modes/
.HopCoderX/plans/*.md
.HopCoderX/plugins/
.HopCoderX/skills/<name>/SKILL.md
.HopCoderX/skills/git-release/SKILL.md
.HopCoderX/tools/
.well-known/HopCoderX
{ type: "raw" \| "patch", content: string }
{file:path/to/file}
**/*.js
%USERPROFILE%/intelephense/license.txt
%USERPROFILE%\.cache\HopCoderX
%USERPROFILE%\.config\HopCoderX\HopCoderX.jsonc
%USERPROFILE%\.config\HopCoderX\plugins
%USERPROFILE%\.local\share\HopCoderX
%USERPROFILE%\.local\share\HopCoderX\log
<project-root>/.HopCoderX/themes/*.json
<providerId>/<modelId>
<your-project>/.HopCoderX/plugins/
~
~/...
~/.agents/skills/*/SKILL.md
~/.agents/skills/<name>/SKILL.md
~/.aws/credentials
~/.bashrc
~/.cache/HopCoderX
~/.cache/HopCoderX/node_modules/
~/.claude/CLAUDE.md
~/.claude/skills/
~/.claude/skills/*/SKILL.md
~/.claude/skills/<name>/SKILL.md
~/.config/HopCoderX
~/.config/HopCoderX/AGENTS.md
~/.config/HopCoderX/agents/
~/.config/HopCoderX/commands/
~/.config/HopCoderX/modes/
~/.config/HopCoderX/HopCoderX.json
~/.config/HopCoderX/HopCoderX.jsonc
~/.config/HopCoderX/plugins/
~/.config/HopCoderX/skills/*/SKILL.md
~/.config/HopCoderX/skills/<name>/SKILL.md
~/.config/HopCoderX/themes/*.json
~/.config/HopCoderX/tools/
~/.config/zed/settings.json
~/.local/share
~/.local/share/HopCoderX/
~/.local/share/HopCoderX/auth.json
~/.local/share/HopCoderX/log/
~/.local/share/HopCoderX/mcp-auth.json
~/.local/share/HopCoderX/HopCoderX.jsonc
~/.npmrc
~/.zshrc
~/code/
~/Library/Application Support
~/projects/*
~/projects/personal/
${config.github}/blob/dev/packages/sdk/js/src/gen/types.gen.ts
$HOME/intelephense/license.txt
$HOME/projects/*
$XDG_CONFIG_HOME/HopCoderX/themes/*.json
agent/
agents/
build/
commands/
dist/
http://<wsl-ip>:4096
http://127.0.0.1:8080/callback
http://localhost:<port>
http://localhost:4096
http://localhost:4096/doc
https://app.example.com
https://AZURE_COGNITIVE_SERVICES_RESOURCE_NAME.cognitiveservices.azure.com/
https://hopcoderx.dev/bdr/v1/chat/completions
https://hopcoderx.dev/bdr/v1/messages
https://hopcoderx.dev/bdr/v1/models/gemini-3-flash
https://hopcoderx.dev/bdr/v1/models/gemini-3-pro
https://hopcoderx.dev/bdr/v1/responses
https://RESOURCE_NAME.openai.azure.com/
laravel/pint
log/
model: "anthropic/claude-sonnet-4-5"
modes/
node_modules/
openai/gpt-4.1
hopcoderx.dev/config.json
HopCoderX/<model-id>
HopCoderX/gpt-5.1-codex
HopCoderX/gpt-5.2-codex
HopCoderX/kimi-k2
openrouter/google/gemini-2.5-flash
opncd.ai/s/<share-id>
packages/*/AGENTS.md
plugins/
project/
provider_id/model_id
provider/model
provider/model-id
rm -rf ~/.cache/HopCoderX
skills/
skills/*/SKILL.md
src/**/*.ts
themes/
tools/
```

## Keybind strings

```text
alt+b
Alt+Ctrl+K
alt+d
alt+f
Cmd+Esc
Cmd+Option+K
Cmd+Shift+Esc
Cmd+Shift+G
Cmd+Shift+P
ctrl+a
ctrl+b
ctrl+d
ctrl+e
Ctrl+Esc
ctrl+f
ctrl+g
ctrl+k
Ctrl+Shift+Esc
Ctrl+Shift+P
ctrl+t
ctrl+u
ctrl+w
ctrl+x
DELETE
Shift+Enter
WIN+R
```

## Model ID strings referenced

```text
{env:HOPCODERX_MODEL}
anthropic/claude-3-5-sonnet-20241022
anthropic/claude-haiku-4-20250514
anthropic/claude-haiku-4-5
anthropic/claude-sonnet-4-20250514
anthropic/claude-sonnet-4-5
gitlab/duo-chat-haiku-4-5
lmstudio/google/gemma-3n-e4b
openai/gpt-4.1
openai/gpt-5
HopCoderX/gpt-5.1-codex
HopCoderX/gpt-5.2-codex
HopCoderX/kimi-k2
openrouter/google/gemini-2.5-flash
```
