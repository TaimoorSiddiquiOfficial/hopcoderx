---
name: Context System
description: Documentation for the lazy context loading system
tags: [context, lazy-loading, configuration]
categories: [documentation, feature]
---

# Context System

The context system provides lazy loading of project-specific documentation and guidelines.

## Features

- **Lazy Loading**: Context files are loaded on-demand based on query relevance
- **Token Budget**: Configurable limits prevent context overflow
- **LRU Eviction**: Least recently used files are evicted when budget is exceeded
- **Relevance Scoring**: Files are scored based on keywords, recency, and conversation context

## Configuration

Add to your `hopcoderx.json`:

```json
{
  "context": {
    "enabled": true,
    "directory": ".hopcoderx/context",
    "autoLoad": true,
    "notifyOnLoad": true,
    "maxFiles": 10,
    "maxTotalTokens": 50000
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable context loading |
| `directory` | string | `.hopcoderx/context` | Context directory path |
| `autoLoad` | boolean | `true` | Auto-load relevant files based on query |
| `notifyOnLoad` | boolean | `true` | Show notification when files load |
| `maxFiles` | number | `10` | Maximum files to keep loaded |
| `maxTotalTokens` | number | `50000` | Maximum total tokens |

## CLI Commands

```bash
# List available context files
hopcoderx context list

# Show loading status
hopcoderx context status

# Load a specific file
hopcoderx context load architecture.md

# Unload a file
hopcoderx context unload architecture.md

# Clear all loaded context
hopcoderx context clear

# Rescan context directory
hopcoderx context scan
```

## How It Works

1. **Scan**: On session start, `.hopcoderx/context/` is scanned for `.md`, `.json`, `.yaml` files
2. **Index**: Files are indexed with metadata (name, description, tags, categories)
3. **Query**: When you send a message, the query is analyzed for keywords
4. **Score**: Files are scored based on keyword matching, recency, and conversation context
5. **Load**: Files above the threshold are loaded automatically
6. **Evict**: When budget is exceeded, least recently used files are evicted

## Relevance Scoring

Files are scored (0-1) based on:

- **Keyword matching** (50% weight): Query terms in file name, description, tags
- **Recency** (20% weight): Recently loaded files get a bonus
- **Context** (30% weight): Files referenced in conversation get a bonus

Default auto-load threshold: 0.3 (30% relevance)

## File Format

Markdown files use frontmatter:

```markdown
---
name: Display Name
description: Brief description
tags: [tag1, tag2]
categories: [category1]
---

# Content

Your context content...
```

## TUI Integration

The sidebar shows:
- Number of loaded files
- Token usage (current / max)
- List of loaded files (expandable)
