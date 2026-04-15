# Vector Memory System

## Overview

HopCoderX now includes an enhanced vector memory system with session-to-session retention, self-editing capabilities, and automatic pruning. This system provides long-term memory persistence across sessions.

## Features

### 1. Vector Search
- Semantic similarity search using cosine similarity
- Fallback to TF-IDF-style embedding when LanceDB is unavailable
- 256-dimensional embedding vectors for efficient storage

### 2. Session-to-Session Retention
- Automatically loads relevant memories when starting a new session
- Uses query-based retrieval with configurable similarity threshold
- Boosts memories based on recency and access frequency

### 3. Self-Editing Memory Blocks
- Memories can be programmatically updated via `VectorMemory.edit()`
- Tracks auto-edit history with `autoEdited` flag
- Source tracking: user, agent, or extraction

### 4. Automatic Pruning
- Removes memories inactive for 30+ days (configurable)
- Preserves high-score memories (> 0.7) regardless of age
- Maintains minimum memory count (100 by default)

## Usage

### Initialize Vector Memory

```typescript
import { VectorMemory } from "@hopcoderx/memory/vector"
import { LanceDBMemory } from "@hopcoderx/memory/lancedb"

// Initialize with LanceDB backend
const backend = new LanceDBMemory()
await VectorMemory.init(backend, {
  maxMemories: 1000,
  pruneThresholdDays: 30,
  autoLoadThreshold: 0.6,
  autoLoadLimit: 10,
})
```

### Store Memories

```typescript
// Store a new memory
await VectorMemory.store(
  "Always use async/await for file operations in this project",
  ["typescript", "best-practice", "async"],
  {
    projectScope: "/path/to/project",
    source: "user",
    score: 0.8,
  }
)
```

### Search Memories

```typescript
// Search with filters
const results = await VectorMemory.search("file operations", {
  limit: 5,
  projectScope: "/path/to/project",
  tags: ["typescript"],
  minScore: 0.5,
})

for (const result of results) {
  console.log(`Score: ${result.similarity}, Content: ${result.entry.content}`)
}
```

### Edit Memories

```typescript
// Update an existing memory
await VectorMemory.edit("memory-id", {
  content: "Updated content here",
  score: 0.9,
})
```

### Session Retention

Memories are automatically loaded at session start based on:
- User's initial query
- Project scope
- Relevance score (similarity + recency + access count)

### Pruning

```typescript
// Manual pruning
const stats = await VectorMemory.prune({
  inactiveDays: 30,
  minKeep: 100,
})
console.log(`Pruned ${stats.pruned} memories, kept ${stats.kept}`)
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxMemories` | 1000 | Maximum memories before pruning |
| `pruneThresholdDays` | 30 | Days of inactivity before pruning |
| `autoLoadThreshold` | 0.6 | Minimum similarity for auto-loading |
| `autoLoadLimit` | 10 | Max memories loaded per session |

## Memory Block Structure

```typescript
interface MemoryBlock {
  id: string
  content: string
  tags: string[]
  projectScope: string | null
  embedding?: number[]
  createdAt: number
  updatedAt: number
  lastAccessedAt: number
  accessCount: number
  sessionIDs: string[]
  autoEdited: boolean
  score: number
  source: "user" | "agent" | "extraction"
}
```

## Backend Options

### LanceDB (Recommended)
- Full vector search capabilities
- Persistent storage in `~/.hopcoderx/data/memory-lancedb`
- Install: `bun add vectordb`

### In-Memory Fallback
- Used when LanceDB is not installed
- No persistence across restarts
- Still provides search functionality

## Integration Points

1. **Session Start**: Automatically loads relevant memories
2. **Plugin Hooks**: Can be triggered via `memory.store` plugin event
3. **CLI Commands**: `hopcoderx memory` for management

## Best Practices

1. **Tag consistently**: Use descriptive tags for better filtering
2. **Set project scope**: Scope memories to specific projects when relevant
3. **Monitor scores**: Higher scores prevent pruning
4. **Regular pruning**: Run pruning periodically to manage memory size
