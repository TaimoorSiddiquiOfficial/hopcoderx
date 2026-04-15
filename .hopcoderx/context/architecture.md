---
name: Architecture
description: HopCoderX system architecture overview
tags: [architecture, system, design]
categories: [documentation, overview]
---

# HopCoderX Architecture

## Core Components

### Session Management (`src/session/`)
- `prompt.ts` - Main prompt processing and LLM interaction
- `message-v2.ts` - Message format and handling
- `compaction.ts` - Context window compaction
- `tiering.ts` - Message tiering (pinned, recent, archive)
- `instruction.ts` - System and instruction prompts

### Context System (`src/context/`)
- `index.ts` - Main context API
- `loader.ts` - Lazy loading with LRU eviction
- `registry.ts` - Context file scanning and indexing
- `relevance.ts` - Query-based relevance scoring

### Agent System (`src/agent/`)
- `agent.ts` - Agent definitions and execution
- `orchestrator.ts` - Multi-agent coordination
- `swarm.ts` - Swarm agent patterns

### Tool System (`src/tool/`)
- `bash.ts` - Shell command execution
- `read.ts` - File reading
- `edit.ts` - File editing
- `task.ts` - Task management

### MCP Integration (`src/mcp/`)
- Model Context Protocol server connections
- Resource and prompt handling
- Tool bridging

### Project Instance (`src/project/`)
- `instance.ts` - Per-project state management
- `bootstrap.ts` - Project initialization

## Data Flow

```
User Input → Session Prompt → Agent Selection → Tool Execution → Response
                ↓
        Context Loading (lazy)
                ↓
        Message History (tiered)
                ↓
        LLM API Call
```

## Configuration

- `src/config/config.ts` - Configuration schema and loading
- `hopcoderx.json` - Project-level config
- Global config in `~/.hopcoderx/`

## Event System

- `src/bus/` - Event bus for state changes
- `GlobalBus` - Cross-instance events
- TUI sync via event listeners
