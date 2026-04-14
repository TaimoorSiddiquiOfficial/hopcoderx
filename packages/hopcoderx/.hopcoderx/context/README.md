# Context Directory

This directory contains context files for lazy loading in HopCoderX.

## Usage

Context files are automatically loaded based on:
- **Query relevance** - Files matching your questions are loaded
- **Recency** - Recently loaded files have higher priority
- **Directory context** - Files related to current working directory

## File Formats

### Markdown (.md)
```markdown
---
name: My Context File
description: What this file contains
tags: [tag1, tag2]
categories: [category1]
---

Your content here...
```

### JSON (.json)
```json
{
  "name": "My Context File",
  "description": "What this file contains",
  "tags": ["tag1", "tag2"],
  "categories": ["category1"],
  "content": "Your content here..."
}
```

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

## Configuration

Add to `hopcoderx.json`:

```json
{
  "context": {
    "enabled": true,
    "autoLoad": true,
    "maxFiles": 10,
    "maxTotalTokens": 50000,
    "autoLoadThreshold": 0.3
  }
}
```

## Best Practices

1. **Keep files focused** - One topic per file
2. **Use descriptive tags** - Helps relevance matching
3. **Organize with categories** - Group related context
4. **Monitor token usage** - Use `hopcoderx context status`
