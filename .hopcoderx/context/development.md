---
name: Development Guide
description: Development guidelines and workflows for HopCoderX
tags: [development, workflow, testing]
categories: [documentation, guide]
---

# HopCoderX Development Guide

## Project Structure

```
packages/hopcoderx/
├── src/
│   ├── agent/        # Agent system
│   ├── bus/          # Event bus
│   ├── cli/          # CLI commands and TUI
│   ├── config/       # Configuration
│   ├── context/      # Lazy context loading
│   ├── mcp/          # MCP integration
│   ├── session/      # Session management
│   ├── tool/         # Tool implementations
│   └── util/         # Utilities
└── test/
    └── unit/         # Unit tests
```

## Development Commands

```bash
# Development mode
bun run dev

# Type checking
bun run typecheck

# Build
bun run build

# Run tests
bun test

# Lint
bun run lint
```

## Adding New Commands

1. Create `src/cli/cmd/<name>.ts`
2. Export command using `cmd()` helper
3. Add to command group in `src/cli/command-groups/`

## Adding New Tools

1. Create `src/tool/<name>.ts`
2. Implement tool schema and handler
3. Register in tool registry

## Testing Guidelines

- Unit tests in `test/unit/`
- Use mock providers for API tests
- Test edge cases for tools

## Code Style

- TypeScript strict mode
- No `any` types - use proper generics
- Log errors, don't swallow them
- Use `Log` utility for consistent logging

## Common Patterns

### Instance State

```typescript
const state = Instance.state(() => ({
  // State object
}), async (current) => {
  // Cleanup on dispose
})
```

### Event Publishing

```typescript
GlobalBus.emit("event", {
  directory: Instance.directory,
  payload: {
    type: "custom.event",
    properties: { /* ... */ },
  },
})
```

### Configuration

```typescript
const config = await Config.get()
const value = config.customSetting ?? defaultValue
```
