# Deep Research Report: Multi-Agent & Session Architecture in HopCoderX

> **Purpose**: Architectural research for implementing a Multi-Agent Swarm (Planner → Coder → Reviewer pattern).  
> **Scope**: `packages/hopcoderx/src/` — session system, provider/model system, tool system, config system, and existing extensibility patterns.  
> **Generated**: June 2025

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Session System](#2-session-system)
3. [Agent System](#3-agent-system)
4. [Provider & Model System](#4-provider--model-system)
5. [Tool System](#5-tool-system)
6. [Config System](#6-config-system)
7. [Existing Extensibility Patterns](#7-existing-extensibility-patterns)
8. [Critical Discovery: Existing Orchestrator Infrastructure](#8-critical-discovery-existing-orchestrator-infrastructure)
9. [Swarm Design Implications](#9-swarm-design-implications)
10. [Appendix: Key Type Signatures](#10-appendix-key-type-signatures)

---

## 1. Executive Summary

The HopCoderX codebase already contains **substantial infrastructure for multi-agent orchestration**. There is an existing `Orchestrator` namespace with task decomposition, an `AgentContext` with step/dependency tracking, a `TaskTool` that spawns child sessions for subagent invocation, and an Agent system with mode distinctions (`primary`, `subagent`, `orchestrator`, `all`). The Planner → Coder → Reviewer swarm can be implemented by extending these existing primitives rather than building from scratch.

### Key Architectural Facts

| Component | File | Lines | Purpose |
|---|---|---|---|
| Conversation loop | `session/prompt.ts` | 2001 | The `while(true)` loop driving all agent interactions |
| LLM streaming | `session/llm.ts` | ~280 | Wraps Vercel AI SDK `streamText()` |
| Stream processor | `session/processor.ts` | 422 | Handles one LLM cycle → returns `"continue" \| "stop" \| "compact"` |
| Agent definitions | `agent/agent.ts` | 340 | Agent types, built-in agents, config merging |
| **Orchestrator** | `agent/orchestrator.ts` | 106 | **Existing task decomposition into steps** |
| **Agent context** | `agent/context.ts` | 82 | **Step schema with status/dependencies/gaps** |
| Subagent invocation | `tool/task.ts` | 166 | Creates child sessions for subagent execution |
| Agent switching | `tool/plan.ts` | 131 | PlanExitTool / PlanEnterTool pattern |
| Tool factory | `tool/tool.ts` | ~90 | `Tool.define()` pattern |
| Tool registry | `tool/registry.ts` | ~200 | Built-in + custom + plugin tools |
| Config schema | `config/config.ts` | 1517 | Agent configs, experimental flags, permissions |
| Provider system | `provider/provider.ts` | 1344 | Model registration, resolution, language model creation |

**Runtime**: Bun + TypeScript, Vercel `ai` SDK, Drizzle ORM + SQLite, Zod schemas throughout.

---

## 2. Session System

### 2.1 Session Schema & Storage

**File**: `session/session.sql.ts` + `session/index.ts`

Sessions are stored in SQLite via Drizzle ORM. The `Session.Info` type (Zod schema):

```
Session.Info = {
  id: string,              // Identifier.descending("session")
  slug: string,            // Slug.create()
  projectID: string,
  directory: string,
  parentID?: string,       // ← CRITICAL: child sessions for subagents
  title: string,
  version: string,
  time: { created, updated, compacting?, archived? },
  permission?: PermissionNext.Ruleset,  // Session-level permissions
  summary?: { additions, deletions, files, diffs? },
  share?: { url },
  revert?: { messageID, partID?, snapshot?, diff? },
}
```

**Parent-child relationship**: `Session.create({ parentID })` creates a child session. This is the mechanism used by `TaskTool` to spawn subagent sessions. `Session.children(parentID)` queries all children.

**Key functions** (`session/index.ts`):
- `Session.create({ parentID?, title?, permission? })` — creates new session (line ~232)
- `Session.get(id)` — retrieves session by ID
- `Session.messages({ sessionID, limit? })` — retrieves all messages with parts
- `Session.fork({ sessionID, messageID? })` — forks session at a point (deep copies messages)
- `Session.updateMessage(msg)`, `Session.updatePart(part)` — mutation via Drizzle
- `Session.getUsage({ model, usage, metadata })` — computes cost/tokens from AI SDK usage

### 2.2 The Conversation Loop

**File**: `session/prompt.ts` — **the most critical file for swarm integration**

#### Entry Point: `SessionPrompt.prompt(input)`

**Signature** (line ~163):
```ts
SessionPrompt.prompt(input: PromptInput): Promise<MessageV2.WithParts>
```

Where `PromptInput` is:
```ts
{
  sessionID: string,
  messageID?: string,
  model?: { providerID, modelID },
  agent?: string,
  noReply?: boolean,
  tools?: Record<string, boolean>,
  format?: MessageV2.Format,
  system?: string,
  variant?: string,
  parts: (TextPart | FilePart | AgentPart | SubtaskPart)[],
}
```

`prompt()` does:
1. Creates a user message via `createUserMessage(input)`
2. Sets session-level permissions from `input.tools` (legacy)
3. Calls `loop({ sessionID })` unless `noReply: true`

#### The Loop: `SessionPrompt.loop(input)`

**Signature** (line ~263):
```ts
SessionPrompt.loop(input: { sessionID, resume_existing? }): Promise<MessageV2.WithParts>
```

The `while(true)` loop:

```
Step 1: Fetch all messages via MessageV2.filterCompacted(MessageV2.stream(sessionID))
Step 2: Find lastUser, lastAssistant, lastFinished, and pending tasks
Step 3: Check exit conditions:
  - No user message → error
  - lastAssistant finished (not tool-calls/unknown) and after lastUser → break
Step 4: Handle pending tasks in priority order:
  a) SubtaskPart → invoke TaskTool directly (lines ~350-500)
  b) CompactionPart → invoke SessionCompaction.process()
  c) Context overflow check → create CompactionPart
Step 5: Normal processing:
  a) Get agent via Agent.get(lastUser.agent)
  b) Check maxSteps (agent.steps ?? Infinity) → isLastStep
  c) Insert reminder messages
  d) Create assistant message
  e) Create SessionProcessor
  f) Resolve tools via resolveTools()
  g) Inject StructuredOutput tool if JSON schema format
  h) Call processor.process(streamInput) → returns "continue" | "stop" | "compact"
Step 6: Post-processing:
  a) Check SafeRefactor → may inject synthetic retry message
  b) Check structured output capture
  c) Handle "stop" / "compact" results
```

**Abort mechanism**: `SessionPrompt.cancel(sessionID)` aborts the AbortController stored in the session state.

**Busy guard**: `SessionPrompt.assertNotBusy(sessionID)` throws `Session.BusyError` if a session loop is already running.

### 2.3 Stream Processing

**File**: `session/processor.ts`

```ts
SessionProcessor.create(input: {
  assistantMessage: MessageV2.Assistant,
  sessionID: string,
  model: Provider.Model,
  abort: AbortSignal,
}) → {
  message: MessageV2.Assistant,
  partFromToolCall(callID): MessageV2.ToolPart,
  process(streamInput: LLM.StreamInput): Promise<"continue" | "stop" | "compact">,
}
```

`process()` behavior:
- Calls `LLM.stream(streamInput)` to get the AI SDK stream
- Iterates over `stream.fullStream` events: `reasoning-*`, `tool-input-start`, `tool-call`, `tool-result`, `tool-error`, `text-*`, `start-step`, `finish-step`, `error`
- **Doom loop detection**: If the last `DOOM_LOOP_THRESHOLD` (3) tool calls are identical (same tool, same input), triggers a `PermissionNext.ask()` for `"doom_loop"` permission
- **Error handling**: Retryable errors → exponential backoff via `SessionRetry`; non-retryable → sets `error` on assistant message
- **Snapshot tracking**: `Snapshot.track()` at step start, `Snapshot.patch()` at step finish. Patch diffs stored as `PatchPart`.
- **Compaction trigger**: If `SessionCompaction.isOverflow()` after a step, returns `"compact"`
- **Permission rejection**: If a tool error is a `PermissionNext.RejectedError` or `Question.RejectedError`, sets `blocked = true` → returns `"stop"` (unless `continue_loop_on_deny` is enabled)

### 2.4 LLM Streaming

**File**: `session/llm.ts`

```ts
LLM.StreamInput = {
  user: MessageV2.User,
  sessionID: string,
  model: Provider.Model,
  agent: Agent.Info,
  system: string[],
  abort: AbortSignal,
  messages: ModelMessage[],
  small?: boolean,
  tools: Record<string, Tool>,
  retries?: number,
  toolChoice?: "auto" | "required" | "none",
}
```

`LLM.stream(input)`:
1. Resolves `Provider.getLanguage(model)` to get the AI SDK language model
2. Builds system prompt: agent.prompt > SystemPrompt.provider(model) > input.system > user.system
3. Applies `Plugin.trigger("experimental.chat.system.transform")` for plugins
4. Merges options: `base → model.options → agent.options → variant`
5. Filters tools via `PermissionNext.disabled()` and `user.tools`
6. LiteLLM proxy compatibility: adds `_noop` dummy tool when history has tool calls but no active tools
7. Calls Vercel AI SDK's `streamText()` with:
   - `wrapLanguageModel()` middleware for `ProviderTransform.message()`
   - `experimental_repairToolCall` for case-insensitive tool name repair
   - Telemetry support via `experimental_telemetry`

### 2.5 Message Type System

**File**: `session/message-v2.ts` (~900 lines)

Two message roles: `MessageV2.User` and `MessageV2.Assistant`

**User message fields**:
```ts
{
  id, sessionID, role: "user",
  agent: string,          // Which agent handles this
  model: { providerID, modelID },
  variant?: string,
  system?: string,        // Custom system prompt
  tools?: Record<string, boolean>,
  format?: Format,        // { type: "text" } | { type: "json_schema", schema }
  time: { created },
}
```

**Assistant message fields**:
```ts
{
  id, sessionID, role: "assistant",
  parentID: string,       // Links to user message
  agent: string,
  mode: string,
  variant?: string,
  modelID, providerID,
  cost: number,
  tokens: { input, output, reasoning, cache: { read, write } },
  time: { created, completed? },
  finish?: string,        // AI SDK finish reason
  error?: Error,
  structured?: unknown,
  summary?: boolean,
  path: { cwd, root },
}
```

**Part types** (discriminated union on `type`):
- `TextPart`: { text, synthetic?, ignored? }
- `ReasoningPart`: { text, metadata? }
- `ToolPart`: { tool, callID, state: ToolState }
  - `ToolState` variants: pending → running → completed/error
  - Running: `{ status: "running", input, time: { start }, title?, metadata? }`
  - Completed: `{ status: "completed", input, output, metadata, title, time: { start, end }, attachments? }`
- `FilePart`: { url, filename?, mime }
- `AgentPart`: { name }  — indicates @ agent invocation
- **`SubtaskPart`**: { prompt, description, agent, model?, command? } — **deferred subtask for loop processing**
- `CompactionPart`: { auto? } — triggers compaction
- `StepStartPart`, `StepFinishPart`, `PatchPart`, `SnapshotPart`, `RetryPart`

**Critical**: `MessageV2.toModelMessages(msgs, model)` converts internal messages to AI SDK `ModelMessage[]` format for LLM calls.

### 2.6 Compaction

**File**: `session/compaction.ts` (~262 lines)

- `SessionCompaction.isOverflow({ tokens, model })`: Checks if current token usage exceeds model context limit (with headroom)
- `SessionCompaction.prune({ sessionID })`: Erases tool output from old messages when total tool call tokens exceed 40K. Marks pruned tool parts with `time.compacted`.
- `SessionCompaction.create({ sessionID, agent, model, auto })`: Creates a `CompactionPart` on a new user message. The next loop iteration picks this up.
- `SessionCompaction.process({ messages, parentID, abort, sessionID, auto })`: Runs the `compaction` agent to summarize conversation history. Returns `"stop"` or signals continuation.

### 2.7 Safe Refactor

**File**: `session/safe-refactor.ts` (107 lines)

Post-edit LSP error checking:
- `SafeRefactor.check({ sessionID, messageID })`: Returns `{ retry: boolean, files: string[] }`
- Checks `diagnosticErrors(messageID)` for tool parts with `metadata.diagnostics`
- If files with severity-1 errors found and attempts < `maxRetries` (default 3), returns `retry: true`
- In `prompt.ts`, this triggers a synthetic user message: `"<safe-refactor attempt=\"X/Y\">...fix errors..."`

### 2.8 Instruction System

**File**: `session/instruction.ts` (~200 lines)

Instruction files (`AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`) are loaded from:
- Project directory (walk up to worktree root)
- Global config directory
- `~/.claude/CLAUDE.md` (compatibility)
- URLs from `config.instructions`

These are injected into the system prompt via `InstructionPrompt.system()`. The `InstructionPrompt.resolve()` function discovers per-directory instruction files when the agent reads files in new directories.

---

## 3. Agent System

### 3.1 Agent Definition

**File**: `agent/agent.ts` (340 lines)

```ts
Agent.Info = {
  name: string,
  description?: string,
  mode: "subagent" | "primary" | "all" | "orchestrator",
  native?: boolean,
  hidden?: boolean,
  topP?: number,
  temperature?: number,
  color?: string,
  permission: PermissionNext.Ruleset,
  model?: { modelID, providerID },
  variant?: string,
  prompt?: string,
  options: Record<string, any>,
  steps?: number,         // Max agentic iterations
}
```

**Mode semantics**:
- `"primary"`: Top-level agents (build, plan). Shown in agent picker. Cannot be invoked as subagents.
- `"subagent"`: Called via TaskTool. Not shown as default. Can be used with `@agent` syntax.
- `"all"`: Can act as either primary or subagent. Default for user-defined agents from config.
- `"orchestrator"`: Reserved mode (defined in schema but not yet used by any built-in agent).

### 3.2 Built-in Agents

| Agent | Mode | Key Characteristics |
|---|---|---|
| `build` | primary | Default agent. Full tool permissions. Has `question: "allow"`, `plan_enter: "allow"`. |
| `plan` | primary | Edit-restricted. Can only write to `.hopcoderx/plans/*.md`. Has `plan_exit: "allow"`. |
| `general` | subagent | General-purpose for multi-step tasks. Denies `todoread`/`todowrite`. |
| `explore` | subagent | Read-only codebase exploration. Only allows grep/glob/list/bash/read/webfetch/websearch. Has dedicated prompt (`prompt/explore.txt`). |
| `compaction` | primary, hidden | Summarizes conversation history. All tools denied. |
| `title` | primary, hidden | Generates session titles. Temperature 0.5. |
| `summary` | primary, hidden | Generates session summaries. |

### 3.3 Config-Driven Agent Customization

**File**: `agent/agent.ts`, lines ~208-232

The `state()` initializer iterates over `cfg.agent` entries:
```ts
for (const [key, value] of Object.entries(cfg.agent ?? {})) {
  if (value.disable) { delete result[key]; continue }
  let item = result[key]
  if (!item) item = result[key] = { name: key, mode: "all", permission, options: {}, native: false }
  // Override: model, variant, prompt, description, temperature, topP, mode, color, hidden, name, steps, options, permission
}
```

This means:
- Existing agents (build, plan, etc.) can be **overridden** with new prompts, models, temperatures, etc.
- Brand new agents can be **created** by adding a key that doesn't match any built-in
- Agents can be **disabled** with `disable: true`
- New agents default to `mode: "all"` (usable as both primary and subagent)

### 3.4 Agent API

- `Agent.get(name: string)` → `Promise<Agent.Info | undefined>` — looks up agent by name
- `Agent.list()` → `Promise<Agent.Info[]>` — all agents, sorted (default agent first)
- `Agent.defaultAgent()` → `Promise<string>` — returns default agent name (from `cfg.default_agent` or first primary visible)
- `Agent.generate({ description, model? })` — uses LLM to generate new agent config from description

---

## 4. Provider & Model System

### 4.1 Provider & Model Types

**File**: `provider/provider.ts` (1344 lines)

```ts
Provider.Model = {
  id: string,           // e.g. "claude-sonnet-4-20250514"
  providerID: string,   // e.g. "anthropic"
  api: { id, url?, npm },  // npm = AI SDK package name
  name: string,
  family?: string,      // e.g. "claude", "gpt"
  capabilities: { temperature, topP, topK, streaming, images, pdf, reasoning, computer, maxTemp },
  cost?: { input, output, cache? },
  limit?: { context, output },
  status?: string,
  options?: Record<string, any>,
  headers?: Record<string, string>,
  release_date?: string,
  variants?: Record<string, any>,
}

Provider.Info = {
  id: string,
  name: string,
  source: "bundled" | "config" | "env",
  env?: string[],       // Required env vars
  key?: string,
  options?: Record<string, any>,
  models: Provider.Model[],
}
```

### 4.2 Key Provider Functions

- `Provider.getModel(providerID, modelID)` → `Promise<Provider.Model>` — resolves model, throws `ModelNotFoundError` with suggestions
- `Provider.getLanguage(model)` → `Promise<LanguageModelV2>` — creates AI SDK language model from npm package
- `Provider.getProvider(providerID)` → `Promise<Provider.Info>`
- `Provider.defaultModel()` → `Promise<{ providerID, modelID }>`
- `Provider.parseModel(str)` → `{ providerID, modelID }` — parses `"provider/model"` format
- `Provider.list()` — all available providers
- `Provider.models()` — all available models across providers

### 4.3 Model Resolution Pipeline

State initialization in `provider.ts`:
1. Load `ModelsDev` data (fetched/cached model catalog)
2. Merge `cfg.provider` overrides from config
3. Detect env-based providers (check for API key env vars)
4. Apply `CUSTOM_LOADERS` for special providers (anthropic, openai, bedrock, etc.)
5. Merge config model overrides (`cfg.provider[id].models[modelID] = { ... }`)

---

## 5. Tool System

### 5.1 Tool Factory

**File**: `tool/tool.ts` (~90 lines)

```ts
Tool.define<P extends z.ZodType, M extends Metadata>(
  id: string,
  init: ((ctx?: InitContext) => Promise<ToolDef>) | StaticToolDef
): Tool.Info<P, M>
```

`Tool.Context` provided to `execute()`:
```ts
{
  sessionID: string,
  messageID: string,
  agent: string,
  abort: AbortSignal,
  callID?: string,
  extra?: Record<string, any>,
  messages: MessageV2.WithParts[],
  metadata(input: { title?, metadata? }): void,
  ask(input: PermissionRequest): Promise<void>,
}
```

`Tool.InitContext`:
```ts
{ agent?: Agent.Info }
```

Execute return type:
```ts
{ title: string, metadata: M, output: string, attachments?: FilePart[] }
```

Auto-truncation: `Truncate.output()` is applied unless `metadata.truncated` is already set.

### 5.2 Tool Registry

**File**: `tool/registry.ts` (~200 lines)

```ts
ToolRegistry.state()     // Loads custom tools from .hopcoderx/{tool,tools}/*.{js,ts} + plugins
ToolRegistry.register()  // Dynamic runtime registration
ToolRegistry.all()       // All tools: built-in + custom + experimental
ToolRegistry.ids()       // All tool IDs
ToolRegistry.tools(model, agent?)  // Initialized tools for model/agent combo
```

**Built-in tool list** (from `all()`, line ~130):
```
InvalidTool, QuestionTool*, BashTool, ReadTool, GlobTool, GrepTool,
EditTool, WriteTool, TaskTool, WebFetchTool, TodoWriteTool,
WebSearchTool*, CodeSearchTool*, SemanticSearchTool*,
SkillTool, ApplyPatchTool*, LspTool*, BatchTool*, PlanExitTool*, PlanEnterTool*
+ custom tools from plugins/files
```
(* = conditionally included based on flags/config)

**Model-specific filtering**:
- `apply_patch` for GPT models (non-oss, non-gpt-4)
- `edit` + `write` for all other models
- `websearch`/`codesearch` only for `hopcoderx` provider or `HOPCODERX_ENABLE_EXA`

**Tool initialization** in `tools(model, agent?)`:
- Each tool's `init(ctx)` is called with `{ agent }` context
- `Plugin.trigger("tool.definition", { toolID }, output)` hook fires after init
- Returns `{ id, description, parameters, execute }`

### 5.3 Tool Resolution in prompt.ts

**Function**: `SessionPrompt.resolveTools()` (line ~790 in prompt.ts)

```ts
resolveTools(input: {
  agent: Agent.Info,
  model: Provider.Model,
  session: Session.Info,
  tools?: Record<string, boolean>,
  processor: SessionProcessor.Info,
  bypassAgentCheck: boolean,
  messages: MessageV2.WithParts[],
}) → Record<string, AITool>
```

Process:
1. Get tools from `ToolRegistry.tools(model, agent)`
2. For each tool: apply `ProviderTransform.schema()` for model compatibility
3. Wrap `execute()` with: context creation, `Plugin.trigger("tool.execute.before")`, execution, `Plugin.trigger("tool.execute.after")`
4. Add MCP tools from `MCP.tools()` with same wrapping + permission check
5. The `context()` factory creates `Tool.Context` with `ask()` bound to session+agent permissions

### 5.4 TaskTool — The Subagent Invocation Mechanism

**File**: `tool/task.ts` (166 lines) — **CRITICAL for swarm design**

Parameters:
```ts
{
  description: string,     // 3-5 word task description
  prompt: string,          // Task for the agent
  subagent_type: string,   // Agent name
  task_id?: string,        // Resume previous task
  command?: string,
}
```

Execution flow:
1. Permission check via `ctx.ask({ permission: "task", patterns: [subagent_type] })` (bypassed if user explicitly invoked via `@`)
2. Resolve agent: `Agent.get(params.subagent_type)`
3. Create or resume child session: `Session.create({ parentID: ctx.sessionID, title, permission })`
   - Child session denies `todowrite`, `todoread`
   - If agent lacks `task` permission explicitly, also denies `task` (prevents recursive subagents)
4. Determine model: `agent.model ?? parent's model`
5. Call `SessionPrompt.prompt({ sessionID: child.id, model, agent: agent.name, parts, tools })`
6. Extract last text part from result
7. Return output wrapped in `<task_result>...</task_result>` tags with `task_id` for resumption

**Key**: Child sessions inherit the full session loop. Each subagent gets its own conversation history, its own messages, its own tool calls. The parent session sees only the final text output.

### 5.5 PlanTool — Agent Switching Pattern

**File**: `tool/plan.ts` (131 lines)

Two tools for switching between plan and build agents:

**PlanExitTool** (`plan_exit`):
- Asks user for confirmation
- Creates synthetic user message with `agent: "build"`
- Injects instruction: "Execute the plan"

**PlanEnterTool** (`plan_enter`):
- Asks user for confirmation
- Creates synthetic user message with `agent: "plan"`
- Injects instruction: "Switch to plan mode and begin planning"

**Pattern**: Agent switching is done by creating a new user message with a different `agent` field. The next loop iteration picks up the new agent.

---

## 6. Config System

### 6.1 Agent Configuration Schema

**File**: `config/config.ts`, lines 685-772

```ts
Config.Agent = {
  model?: string,            // "provider/model" format
  variant?: string,
  temperature?: number,
  top_p?: number,
  prompt?: string,
  tools?: Record<string, boolean>,  // @deprecated → use 'permission'
  disable?: boolean,
  description?: string,
  mode?: "subagent" | "primary" | "all",
  hidden?: boolean,
  options?: Record<string, any>,
  color?: string | ThemeColor,
  steps?: number,            // Max agentic iterations
  maxSteps?: number,         // @deprecated → use 'steps'
  permission?: Permission,
}
```

Transform logic (lines 720-770):
- Unknown properties extracted into `options`
- Legacy `tools` config converted to `permission` (write/edit/patch/multiedit → edit)
- Legacy `maxSteps` converted to `steps`

### 6.2 Config.Info Agent Field

**File**: `config/config.ts`, line ~1075

```ts
Config.Info = {
  // ...
  agent: {
    plan?: Config.Agent,
    build?: Config.Agent,
    general?: Config.Agent,
    explore?: Config.Agent,
    title?: Config.Agent,
    summary?: Config.Agent,
    compaction?: Config.Agent,
    [key: string]: Config.Agent,  // Custom agents via catchall
  },
  // ...
}
```

### 6.3 Experimental Flags

**File**: `config/config.ts`, line ~1185

```ts
Config.Info.experimental = {
  disable_paste_summary?: boolean,
  batch_tool?: boolean,
  openTelemetry?: boolean,
  primary_tools?: string[],         // Tools exposed to primary agent only
  continue_loop_on_deny?: boolean,  // Don't stop loop on permission deny
  mcp_timeout?: number,
  safe_refactor?: {
    enabled?: boolean,
    max_retries?: number,
  },
  semantic_search?: {
    enabled?: boolean,
    auto_index?: boolean,
  },
}
```

### 6.4 Agent Definition via Markdown Files

Agents can be defined in `.hopcoderx/agents/*.md` files with YAML frontmatter. The frontmatter is validated against `Config.Agent` schema and merged like any config-defined agent.

### 6.5 Config Precedence

```
remote well-known → global (~/.hopcoderx) → custom (HOPCODERX_CONFIG) → project → .hopcoderx dirs → inline → managed
```

---

## 7. Existing Extensibility Patterns

### 7.1 Plugin System

Hooks fired throughout the codebase:

| Hook | Location | Purpose |
|---|---|---|
| `tool.definition` | `registry.ts` | Transform tool description/parameters after init |
| `tool.execute.before` | `prompt.ts` | Pre-execution hook with args |
| `tool.execute.after` | `prompt.ts` | Post-execution hook with result |
| `experimental.chat.system.transform` | `llm.ts` | Transform system prompt array |
| `experimental.chat.messages.transform` | `prompt.ts` | Transform message array before LLM call |
| `experimental.text.complete` | `processor.ts` | Transform completed text output |
| `chat.params` | `llm.ts` | Override temperature, topP, topK, options |
| `chat.headers` | `llm.ts` | Add custom HTTP headers |

### 7.2 Custom Tool Registration

Three mechanisms:
1. **File-based**: `.hopcoderx/{tool,tools}/*.{js,ts}` → auto-loaded at startup
2. **Plugin-based**: Plugins export `tool` property with `ToolDefinition` entries
3. **Runtime**: `ToolRegistry.register(tool)` for dynamic registration

### 7.3 Permission System

**Namespace**: `PermissionNext`

Permissions are rule-based with glob patterns:
```ts
PermissionNext.Ruleset = Array<{
  permission: string,     // Tool name or permission category
  pattern: string,        // Glob pattern
  action: "allow" | "deny" | "ask",
}>
```

Evaluation: `PermissionNext.evaluate(permission, pattern, ruleset)` → `{ action }`

Permission merging: `PermissionNext.merge(base, ...overrides)` — later rules override earlier.

Key permissions: `edit`, `read`, `bash`, `task`, `doom_loop`, `external_directory`, `question`, `plan_enter`, `plan_exit`

### 7.4 Instance.state() Pattern

Used throughout for lazy singletons:
```ts
const state = Instance.state(async () => { /* init */ }, async (current) => { /* cleanup */ })
```
Returns a cached value per project instance. Cleanup runs when instance changes.

### 7.5 Bus Events

The `Bus` system publishes events for real-time updates:
- `Session.Event.Created`, `Updated`, `Deleted`, `Diff`, `Error`
- `MessageV2.Event.Updated`, `Removed`, `PartUpdated`, `PartRemoved`, `PartDelta`

---

## 8. Critical Discovery: Existing Orchestrator Infrastructure

### 8.1 Orchestrator

**File**: `agent/orchestrator.ts` (106 lines)

This file contains a **fully-designed** task decomposition system:

**`Orchestrator.DecomposeResult`**:
```ts
{
  steps: Array<{
    id: string,         // "step-1"
    task: string,       // Specific subtask
    agent: string,      // "build" or "plan"
    depends_on: string[], // Step IDs of prerequisites
    refs: string[],     // File paths or URLs needed
    gaps: string[],     // Missing info
  }>,
  context: {
    refs: Record<string, string>,
    gaps: string[],
  }
}
```

**System prompts**:
- `DECOMPOSE_SYSTEM`: Breaks tasks into max 12 atomic steps with dependencies, refs, and gaps
- `GAP_SYSTEM`: Identifies missing information per step

**Functions**:
- `Orchestrator.assignModels(steps, tier, triedModels)` — assigns models based on tier (free/mini/pro/engineer)
- `Orchestrator.parseJson<T>(raw)` — tolerant JSON parsing (strips markdown fences)
- `Orchestrator.decomposePrompt(task, context)` — builds the user prompt for decomposition
- `Orchestrator.fillGaps(steps, provided)` — removes gaps answered by user-provided context
- `Orchestrator.collectGaps(result)` — aggregates all unfilled gaps
- `Orchestrator.jobId()` — 7-char hex job ID

### 8.2 Agent Context

**File**: `agent/context.ts` (82 lines)

```ts
AgentContext.Step = {
  id: string,
  task: string,
  model: string,
  agent: string,
  depends_on: string[],
  refs: string[],
  gaps: string[],
  status: "pending" | "running" | "done" | "failed",
  output?: string,
  tokens?: number,
  cost?: number,
}

AgentContext.Info = {
  task: string,
  steps: AgentContext.Step[],
  context: { refs: Record<string, string>, gaps: string[] },
  tier?: "free" | "mini" | "pro" | "engineer",
  created_at: number,
}
```

**Free model rotation**:
```ts
FREE_MODELS = [
  { provider: "openrouter", model: "@preset/hopcoder-free" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "cerebras", model: "llama3.1-70b" },
  { provider: "google", model: "gemini-2.0-flash-exp" },
  { provider: "together", model: "Qwen/Qwen2.5-72B-Instruct-Turbo" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
]
```

**Note**: The orchestrator infrastructure exists but is **NOT currently wired into the main loop**. There are no callers of `Orchestrator.decomposePrompt()` or `Orchestrator.assignModels()` in the active codebase. This represents **incomplete scaffolding** ready to be activated.

---

## 9. Swarm Design Implications

### 9.1 What Already Exists

| Capability | Status | Location |
|---|---|---|
| Subagent invocation via child sessions | ✅ Working | `tool/task.ts` |
| Parent-child session hierarchy | ✅ Working | `Session.create({ parentID })` |
| Agent mode system (primary/subagent/orchestrator/all) | ✅ Working | `Agent.Info.mode` |
| Task decomposition into steps | ⚠️ Scaffolded, not wired | `agent/orchestrator.ts` |
| Step dependency tracking | ⚠️ Scaffolded, not wired | `agent/context.ts` |
| Agent switching mid-conversation | ✅ Working | `tool/plan.ts` pattern |
| Per-agent tool permissions | ✅ Working | `Agent.Info.permission` |
| Per-agent model assignment | ✅ Working | `Agent.Info.model` |
| Per-agent temperature/options | ✅ Working | `Agent.Info` fields |
| Per-agent step limits | ✅ Working | `Agent.Info.steps` |
| Custom agent definition via config | ✅ Working | `Config.Agent` + `.hopcoderx/agents/*.md` |
| Context overflow handling | ✅ Working | `session/compaction.ts` |
| Post-edit error checking + retry | ✅ Working | `session/safe-refactor.ts` |
| Plugin hooks for tool/system/message transforms | ✅ Working | `Plugin.trigger()` |
| Structured output via JSON schema | ✅ Working | `StructuredOutput` tool in `prompt.ts` |

### 9.2 Gaps for Planner → Coder → Reviewer Swarm

1. **No multi-agent orchestration loop**: The existing `Orchestrator` decomposes tasks but doesn't execute them. There's no code that iterates over `AgentContext.Step[]`, spawns subagents for each step, tracks completion, and handles failures.

2. **No Reviewer agent pattern**: Current agents are either "do work" (build) or "read only" (explore/plan). No agent is designed to evaluate another agent's output and provide structured feedback.

3. **No inter-agent communication**: Subagents (via TaskTool) return a single text output to the parent. There's no mechanism for a Reviewer to annotate a Coder's output and send it back for revision.

4. **No step status persistence**: `AgentContext.Info` is a pure data type — there's no storage layer. Steps aren't persisted to the database, so no crash recovery.

5. **No parallel step execution**: The existing `Orchestrator.assignModels()` assigns models but steps have `depends_on` — there's no scheduler that identifies parallelizable steps.

6. **SubtaskPart execution is sequential**: `prompt.ts` processes one `SubtaskPart` per loop iteration (line ~350: `const task = tasks.pop()`).

### 9.3 Integration Points for Swarm

The recommended integration points based on researched architecture:

1. **New "orchestrator" agent type**: Use the existing `mode: "orchestrator"` (already in the schema) to define a swarm controller agent. This agent would use the existing `Orchestrator.decomposePrompt()` to break tasks into steps.

2. **Wire orchestrator into prompt.ts loop**: Add handling for orchestrator mode in the main loop, similar to how `SubtaskPart` and `CompactionPart` are handled today.

3. **Define Planner, Coder, Reviewer as agents**: Use `Config.Agent` or `.hopcoderx/agents/*.md` to define these. Each gets its own prompt, model, temperature, permissions, and step limits.

4. **Extend TaskTool for structured review**: The current TaskTool returns `<task_result>text</task_result>`. For Reviewer feedback, extend this to return structured output (use the existing `format: { type: "json_schema" }` support).

5. **Step execution engine**: Build on top of `AgentContext.Step[]` + `Orchestrator`, adding:
   - Step persistence to SQLite (add a new table or use session metadata)
   - A topological sort scheduler for `depends_on`
   - Parallel execution using the existing `BatchTool` pattern
   - Status updates via `Bus.publish()`

6. **Agent context passing**: Use `Session.create({ parentID })` for each step's subagent, and pass step refs + previous step outputs via the `parts` array of `SessionPrompt.prompt()`.

7. **Reviewer loop**: After Coder completes a step, spawn a Reviewer subagent session. If Reviewer returns issues, re-spawn Coder with the feedback. Use the same retry pattern as `SafeRefactor.check()`.

### 9.4 Architecture Patterns to Follow

| Pattern | Example | Use For |
|---|---|---|
| Namespace module | `export namespace Orchestrator {}` | New swarm modules |
| `Instance.state()` lazy singleton | `agent/agent.ts` state init | Swarm state management |
| `Tool.define(id, init)` | `tool/task.ts` | New orchestrator tools |
| Synthetic user message for agent switch | `tool/plan.ts` | Orchestrator → Planner/Coder/Reviewer transitions |
| `SubtaskPart` for deferred execution | `message-v2.ts` | Queueing swarm steps |
| `Session.create({ parentID })` | `tool/task.ts` | Child sessions per step |
| `PermissionNext.Ruleset` per agent | `agent/agent.ts` | Controlling tool access per swarm role |
| Plugin hooks | `prompt.ts` resolveTools | Pre/post hooks for swarm coordination |
| `processor.process()` → `"continue" \| "stop" \| "compact"` | `processor.ts` | Control flow in swarm step execution |
| Bus events for real-time updates | `Session.Event.*` | Swarm progress monitoring |

### 9.5 Recommended Swarm Agent Definitions

Based on existing patterns, here's how the three swarm roles would map:

**Planner** (extend existing `plan` agent):
- `mode: "subagent"` or custom orchestrator handling
- Read-only permissions (like `explore`), plus ability to write plan files
- Uses `Orchestrator.decomposePrompt()` to generate `AgentContext.Step[]`
- Outputs structured JSON: step list with dependencies

**Coder** (extend existing `build` agent):
- `mode: "subagent"`
- Full edit permissions
- Receives step context (task, refs, previous outputs) via prompt parts
- Standard `SafeRefactor` checking applies
- Step limit via `steps` config

**Reviewer** (new):
- `mode: "subagent"`
- Read-only permissions (no edits)
- Structured output format: `{ approved: boolean, issues: [...], suggestions: [...] }`
- Receives: Coder's output + original plan step + diff
- Temperature lower (e.g., 0.2) for consistent evaluation

---

## 10. Appendix: Key Type Signatures

### SessionPrompt.prompt
```ts
// session/prompt.ts, line ~163
SessionPrompt.prompt(input: {
  sessionID: string,
  messageID?: string,
  model?: { providerID: string, modelID: string },
  agent?: string,
  noReply?: boolean,
  tools?: Record<string, boolean>,
  format?: { type: "text" } | { type: "json_schema", schema: Record<string, any> },
  system?: string,
  variant?: string,
  parts: (TextPart | FilePart | AgentPart | SubtaskPart)[],
}): Promise<MessageV2.WithParts>
```

### SessionProcessor.create
```ts
// session/processor.ts, line ~31
SessionProcessor.create(input: {
  assistantMessage: MessageV2.Assistant,
  sessionID: string,
  model: Provider.Model,
  abort: AbortSignal,
}): {
  message: MessageV2.Assistant,
  partFromToolCall(callID: string): MessageV2.ToolPart,
  process(streamInput: LLM.StreamInput): Promise<"continue" | "stop" | "compact">,
}
```

### LLM.stream
```ts
// session/llm.ts, line ~47
LLM.stream(input: {
  user: MessageV2.User,
  sessionID: string,
  model: Provider.Model,
  agent: Agent.Info,
  system: string[],
  abort: AbortSignal,
  messages: ModelMessage[],
  small?: boolean,
  tools: Record<string, Tool>,
  retries?: number,
  toolChoice?: "auto" | "required" | "none",
}): Promise<StreamTextResult>
```

### Tool.define
```ts
// tool/tool.ts, line ~55
Tool.define<P extends z.ZodType, M>(
  id: string,
  init: ((ctx?: { agent?: Agent.Info }) => Promise<{
    description: string,
    parameters: P,
    execute(args: z.infer<P>, ctx: Tool.Context): Promise<{
      title: string, metadata: M, output: string, attachments?: FilePart[]
    }>,
  }>) | StaticToolDef,
): Tool.Info<P, M>
```

### Agent.get / Agent.list
```ts
// agent/agent.ts, line ~253
Agent.get(agent: string): Promise<Agent.Info | undefined>
Agent.list(): Promise<Agent.Info[]>
Agent.defaultAgent(): Promise<string>
```

### Orchestrator
```ts
// agent/orchestrator.ts
Orchestrator.assignModels(steps, tier?, triedModels?): AgentContext.Step[]
Orchestrator.decomposePrompt(task: string, context: Record<string, string>): string
Orchestrator.fillGaps(steps: AgentContext.Step[], provided: Record<string, string>): AgentContext.Step[]
Orchestrator.collectGaps(result): string[]
Orchestrator.parseJson<T>(raw: string): T
```

### Session.create
```ts
// session/index.ts, line ~232
Session.create(input?: {
  parentID?: string,
  title?: string,
  permission?: PermissionNext.Ruleset,
}): Promise<Session.Info>
```

---

*End of research report. This document covers all 5 requested investigation areas with exact file paths, line ranges, function signatures, and architectural patterns needed to design the Planner → Coder → Reviewer multi-agent swarm.*
