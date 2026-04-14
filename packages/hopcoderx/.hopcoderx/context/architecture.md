---
name: Project Architecture
description: Overview of HopCoderX architecture and core components
tags: [architecture, overview, components]
categories: [core, documentation]
---

# HopCoderX Architecture

## Core Components

### Session Management
- `src/session/index.ts` - Session CRUD operations
- `src/session/message-v2.ts` - Message/part serialization
- `src/session/prompt.ts` - Main prompt processing loop
- `src/session/compaction.ts` - Context compaction system

### Context System
- `src/context/registry.ts` - Context file scanning and indexing
- `src/context/loader.ts` - Lazy loading with LRU cache
- `src/context/relevance.ts` - Relevance scoring engine
- `src/context/index.ts` - Main context module API

### CLI Commands
- `src/cli/cmd/` - All CLI command implementations
- `src/cli/cmd/tui/` - Terminal UI components
- `src/cli/command-groups/` - Command groupings

### Tools
- `src/tool/` - Tool implementations (read, write, bash, etc.)
- `src/tool/registry.ts` - Tool registration and discovery
- `src/mcp/` - Model Context Protocol servers

### Plugins
- `src/plugin/` - Plugin system and SDK
- `src/plugin/sdk-v2.ts` - Plugin SDK v2 with hot-reload

### Memory
- `src/memory/` - Memory backends (SQLite, Wiki, LanceDB, Team)
- `src/memory/wiki.ts` - Markdown-based memory backend

## Data Flow

```
User Input → Prompt Processing → Tool Execution → Response
     ↓              ↓                  ↓              ↓
  Context       LLM Call          File System    TUI Display
  Loading
```

## Key Patterns

1. **Lazy Loading** - Context files loaded on-demand based on relevance
2. **LRU Eviction** - Least recently used context unloaded when exceeding budget
3. **Tiered Context** - Pinned (always), Recent (budget), Archive (summarized)
4. **Plugin Hooks** - Extensible via plugin system
