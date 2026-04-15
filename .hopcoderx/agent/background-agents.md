# Background Agents

## Overview

HopCoderX now includes background agent support with async delegation, inspired by Claude Code's background agents and the opencode ecosystem. This system allows you to:

- Run agents asynchronously in the background
- Trigger agents on file changes, schedules, or events
- Delegate tasks to specialized subagents
- Persist context across agent runs

## Features

### 1. Background Agent Types

#### File Change Trigger
Automatically runs when specified files change:
```json
{
  "trigger": {
    "type": "file_change",
    "patterns": ["src/**/*.ts", "tests/**/*.test.ts"],
    "debounceMs": 1000
  }
}
```

#### Schedule Trigger
Runs on a cron-like schedule:
```json
{
  "trigger": {
    "type": "schedule",
    "cron": "*/5 * * * *"  // Every 5 minutes
  }
}
```

#### Event Trigger
Runs when specific events occur:
```json
{
  "trigger": {
    "type": "event",
    "events": ["session.created", "session.completed"]
  }
}
```

#### Manual Trigger
Runs only when explicitly invoked:
```json
{
  "trigger": {
    "type": "manual"
  }
}
```

### 2. Async Delegation

Delegate tasks to subagents without blocking the main session:

```typescript
import { AgentDelegation } from "@hopcoderx/agent/delegate"

const result = await AgentDelegation.delegate({
  sessionID: "current-session-id",
  targetAgent: "reviewer",
  prompt: "Review the changes in src/components/ for security issues",
  persistContext: true,
})
```

### 3. Status Tracking

Monitor background agent execution:

```typescript
import { BackgroundAgentManager } from "@hopcoderx/agent/background"

const status = BackgroundAgentManager.getStatus("my-agent")
console.log(`Running: ${status.running}, Last run: ${status.lastRun}`)
```

## Configuration

Add background agents to your `hopcoderx.config.ts`:

```typescript
export default defineConfig({
  agents: {
    background: [
      {
        id: "test-runner",
        name: "Test Runner",
        description: "Runs tests on file changes",
        trigger: {
          type: "file_change",
          patterns: ["src/**/*.ts", "tests/**/*.ts"],
          debounceMs: 2000,
        },
        context: ["package.json", "vitest.config.ts"],
        delegate: "build",
        persistContext: false,
        enabled: true,
      },
      {
        id: "security-scan",
        name: "Security Scanner",
        description: "Periodic security scanning",
        trigger: {
          type: "schedule",
          cron: "0 * * * *", // Every hour
        },
        context: ["**/*.ts", "**/*.js"],
        delegate: "codereview",
        persistContext: true,
        enabled: true,
      },
    ],
  },
})
```

## Agent Delegation API

### `delegate(request)`

Delegates a task to a subagent.

**Parameters:**
- `sessionID`: Parent session ID
- `targetAgent`: Name of the agent to delegate to
- `prompt`: Task description
- `persistContext`: Whether to save context to parent session
- `model` (optional): Specific model to use

**Returns:** Promise<DelegationResult>

```typescript
interface DelegationResult {
  sessionID: string
  success: boolean
  output?: string
  error?: string
  tokens?: {
    prompt: number
    completion: number
  }
}
```

### `getStatus(delegationID)`

Get the status of a delegation.

**Returns:** DelegationState | undefined

```typescript
interface DelegationState {
  request: DelegationRequest
  status: "pending" | "running" | "completed" | "failed"
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: DelegationResult
}
```

## Background Agent Manager API

### `init()`

Initialize the background agent system.

### `register(agent)`

Register a new background agent.

### `unregister(agentID)`

Unregister a background agent.

### `spawn(agent, context?)`

Manually trigger a background agent.

**Parameters:**
- `agent`: Background agent configuration
- `context`: Optional context (query, files)

### `getStatus(agentID)`

Get an agent's status.

### `list()`

List all registered agents.

### `enable(agentID)` / `disable(agentID)`

Enable or disable an agent.

## Events

Background agents publish events to the event bus:

### `background_agent.executed`

Fired when a background agent completes execution.

```typescript
Bus.event.listen((event) => {
  if (event.type === "background_agent.executed") {
    console.log(`Agent ${event.agentID} completed: ${event.result.success}`)
  }
})
```

### `agent.delegated`

Fired when a delegation completes.

## Use Cases

### 1. Automated Testing
```typescript
{
  id: "test-watcher",
  trigger: {
    type: "file_change",
    patterns: ["src/**/*.ts"],
  },
  delegate: "build",
  persistContext: false,
}
```

### 2. Code Review on Push
```typescript
{
  id: "pr-reviewer",
  trigger: {
    type: "event",
    events: ["git.push"],
  },
  delegate: "reviewer",
  persistContext: true,
}
```

### 3. Hourly Security Scan
```typescript
{
  id: "security-hourly",
  trigger: {
    type: "schedule",
    cron: "0 * * * *",
  },
  delegate: "codereview",
  context: ["**/*.{ts,js,py}"],
  persistContext: true,
}
```

### 4. Documentation Generator
```typescript
{
  id: "doc-generator",
  trigger: {
    type: "file_change",
    patterns: ["src/**/*.ts"],
    debounceMs: 5000,
  },
  delegate: "build",
  context: ["README.md", "docs/"],
  persistContext: false,
}
```

## Best Practices

1. **Use appropriate debounce times**: For file watchers, set `debounceMs` to avoid triggering on every keystroke (1000-5000ms recommended).

2. **Limit context files**: Only include necessary context files to reduce token usage.

3. **Monitor run counts**: Check `status.runCount` and `status.successCount` to ensure agents are working correctly.

4. **Use persistContext wisely**: Set to `true` when the parent session needs to reference the child's work.

5. **Clean up old delegations**: The system auto-cleans after 5 minutes, but you can manually manage state for long-running operations.

## Integration Points

1. **Session Start**: Can trigger event-based agents
2. **File Watcher**: Integrated with HopCoderX's file system
3. **Plugin Hooks**: Extend via `agent.spawn` plugin events
4. **TUI**: Status display in sidebar (future enhancement)
