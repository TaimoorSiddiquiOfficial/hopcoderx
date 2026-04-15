---
name: Context Directory
description: Project-specific context for HopCoderX CLI
tags: [setup, guide]
categories: [documentation]
---

# HopCoderX Context Directory

This directory contains project-specific context files that are lazily loaded based on query relevance.

## Structure

```
.hopcoderx/context/
├── README.md           # This file - setup guide
├── architecture.md     # System architecture overview
├── api-reference.md    # API documentation
├── development.md      # Development guidelines
└── commands/           # Command-specific context
    ├── mcp.md          # MCP server context
    └── context.md      # Context management context
```

## File Format

Context files use markdown with frontmatter:

```markdown
---
name: Display Name
description: Brief description of this context file
tags: [tag1, tag2]
categories: [category1, category2]
---

# Content

Your context content here...
```

## Configuration

Configure context loading in `hopcoderx.json`:

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

## Commands

- `hopcoderx context list` - List available context files
- `hopcoderx context status` - Show loaded context statistics
- `hopcoderx context load <file>` - Load a context file
- `hopcoderx context unload <file>` - Unload a context file
- `hopcoderx context clear` - Clear all loaded context
