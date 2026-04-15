# MCP Servers Enhancement

## Overview

HopCoderX now includes two new built-in MCP servers:

1. **Context Notes** - Project-specific notes, meeting summaries, and architecture decision records
2. **Web Search** - Web search capabilities with multiple engine support

## Context Notes Server

### Features

- **Note CRUD Operations**: Create, read, update, and delete project notes
- **Tag-based Organization**: Organize notes with custom tags
- **Note Types**: Support for general notes, meeting notes, guidelines, todos, and ADRs
- **Meeting Notes**: Structured meeting summaries with action items and assignees
- **Architecture Decision Records (ADR)**: Formal decision documentation with context and consequences
- **Search**: Full-text search across note content and tags
- **Persistent Storage**: Notes stored as markdown files with frontmatter metadata

### Usage

```typescript
// Create a general note
await ContextNotesMCP.createNote({
  title: "Project Kickoff",
  content: "Initial project setup and planning session",
  tags: ["planning", "kickoff"],
  type: "general",
})

// Create a meeting note with action items
await ContextNotesMCP.createMeetingNote({
  title: "Sprint Planning #1",
  date: "2026-04-15",
  attendees: ["Alice", "Bob", "Charlie"],
  summary: "Planned sprint goals and velocity",
  actionItems: [
    { task: "Set up CI/CD pipeline", assignee: "Alice", dueDate: "2026-04-20" },
    { task: "Design database schema", assignee: "Bob", dueDate: "2026-04-18" },
  ],
})

// Create an Architecture Decision Record
await ContextNotesMCP.createADR({
  title: "Use PostgreSQL for Primary Database",
  status: "accepted",
  context: "Need a reliable, ACID-compliant database for transactional data",
  decision: "PostgreSQL 16 with logical replication",
  consequences: [
    "Requires DBA expertise",
    "Higher infrastructure cost than SQLite",
    "Better scalability for growth",
  ],
})

// List notes by type
const adrNotes = await ContextNotesMCP.listNotes({ type: "adr" })

// Search notes
const results = await ContextNotesMCP.searchNotes("database schema")
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `create_note` | Create a new note with title, content, and optional tags |
| `get_note` | Retrieve a specific note by ID |
| `list_notes` | List all notes, optionally filtered by tag or type |
| `search_notes` | Search notes by content, title, or tags |
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `create_meeting_note` | Create a structured meeting note with action items |
| `create_adr` | Create an Architecture Decision Record |

### Configuration

Context Notes is automatically enabled when the `.hopcoderx/notes` directory exists.

```typescript
export default defineConfig({
  mcp: {
    "builtin:context-notes": {
      enabled: true,
    },
  },
})
```

### File Structure

Notes are stored in `.hopcoderx/notes/` as markdown files with frontmatter:

```markdown
---
id: msg_01abc123def456
title: Sprint Planning #1
type: meeting
tags: [meeting, sprint, planning]
createdAt: 2026-04-15T10:00:00.000Z
updatedAt: 2026-04-15T11:30:00.000Z
---

## Summary

Discussed sprint goals and velocity...

## Action Items

- [ ] Set up CI/CD pipeline (@Alice) (Due: 2026-04-20)
- [ ] Design database schema (@Bob) (Due: 2026-04-18)
```

## Web Search Server

### Features

- **Multi-Engine Support**: Brave Search, DuckDuckGo, Google Custom Search
- **Automatic Engine Detection**: Uses available API keys or falls back to DuckDuckGo
- **News Search**: Dedicated news search endpoint
- **Web Page Fetch**: Extract and summarize webpage content
- **Safe Search**: Optional content filtering
- **Domain Filtering**: Include/exclude specific domains
- **Result Scoring**: Relevance-ranked results

### Usage

```typescript
// Basic web search
const results = await WebSearchMCP.search("TypeScript 5.7 release notes", {
  count: 10,
  safeSearch: true,
})

// News search
const newsResults = await WebSearchMCP.searchNews("AI developments 2026", {
  count: 5,
  language: "en",
  country: "US",
})

// Fetch and summarize a webpage
const page = await WebSearchMCP.fetchAndSummarize("https://example.com/article")
console.log(page.title)
console.log(page.summary)
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web for information |
| `web_search_news` | Search for recent news articles |
| `web_fetch` | Fetch and extract content from a webpage |

### Configuration

Web Search works out of the box with DuckDuckGo (no API key required). For better results, configure API keys:

```bash
# Brave Search API (recommended)
export BRAVE_API_KEY="your-brave-api-key"

# Google Custom Search (alternative)
export GOOGLE_API_KEY="your-google-api-key"
export GOOGLE_CSE_ID="your-cse-id"
```

```typescript
export default defineConfig({
  mcp: {
    "builtin:web-search": {
      enabled: true,
    },
  },
})
```

### Engine Comparison

| Engine | API Key Required | Quality | Rate Limits |
|--------|-----------------|---------|-------------|
| DuckDuckGo | No | Good | None (HTML scraping) |
| Brave Search | Yes (free tier) | Excellent | 2,000 requests/month free |
| Google Custom Search | Yes | Excellent | 100 queries/day free |

## Integration

Both servers are registered in the built-in MCP catalog (`src/mcp/builtins.ts`):

- **Context Notes**: `always` launch mode, auto-detected by `.hopcoderx/notes` directory
- **Web Search**: `on-demand` launch mode, auto-detected by `BRAVE_API_KEY` or `GOOGLE_API_KEY` environment variables

## Files

```
src/mcp/
  context-notes.ts          # Context Notes MCP server implementation
  web-search.ts             # Web Search MCP server implementation
  servers/
    context-notes-mcp.ts    # Standalone executable for Context Notes
    web-search-mcp.ts       # Standalone executable for Web Search
  builtins.ts               # Updated with new built-in entries
```

## Best Practices

1. **Use Context Notes for**:
   - Meeting summaries with actionable items
   - Architecture decisions and their rationale
   - Project guidelines and conventions
   - TODO lists and tracking

2. **Use Web Search for**:
   - Finding current documentation
   - Researching latest library versions
   - Checking for security advisories
   - Gathering competitive intelligence

3. **Combine both**:
   - Search web for latest best practices → save as context note
   - Research competing solutions → document decision in ADR
