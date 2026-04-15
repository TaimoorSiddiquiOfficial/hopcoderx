# Session Handoff & Orphan Detection

## Overview

HopCoderX now includes comprehensive session management features for handoff between sessions and orphaned session detection/cleanup.

## Features

### 1. Session Handoff

Create handoff prompts when transferring work between sessions:

- **Summary**: Capture what was accomplished
- **Todos**: Preserve remaining tasks with priority
- **Context**: List key files and information for continuation
- **Resume**: Create child sessions from handoff prompts

### 2. Orphan Detection

Automatically detect and clean up orphaned sessions:

- **No Activity**: Sessions inactive for configurable period (default: 7 days)
- **Parent Deleted**: Sessions whose parent no longer exists
- **Worktree Missing**: Sessions from deleted worktrees (future enhancement)

### 3. Cleanup Options

- **Archive**: Mark sessions as archived (soft delete)
- **Delete**: Permanently remove sessions and children
- **Batch Cleanup**: Process multiple orphans at once

## SessionHandoff API

### `create(input)`

Create a handoff prompt for a session.

```typescript
const handoff = await SessionHandoff.create({
  sessionID: "session-123",
  summary: "Implemented user authentication with JWT tokens",
  todos: [
    { content: "Add password reset", status: "pending", priority: "high" },
    { content: "Write tests", status: "in_progress", priority: "medium" },
  ],
  context: ["src/auth/jwt.ts", "src/middleware/auth.ts"],
})
```

### `resume(input)`

Resume work from a handoff by creating a child session.

```typescript
const result = await SessionHandoff.resume({
  handoff: handoffPrompt,
  title: "Continued: Authentication implementation",
})

console.log(`New session: ${result.session.id}`)
console.log(`Pending todos: ${result.pendingTodos.length}`)
```

### `generate(input)`

Generate a handoff prompt from current session state.

```typescript
const handoff = await SessionHandoff.generate({
  sessionID: "session-123",
})

// Automatically analyzes recent messages and todos
```

## OrphanDetector API

### `detect(options?)`

Detect orphaned sessions.

```typescript
const orphans = await OrphanDetector.detect({
  noActivityDays: 7,           // Default: 7 days
  checkParentExistence: true,  // Check for deleted parents
  checkWorktreeExistence: true, // Check for missing worktrees
})

for (const orphan of orphans) {
  console.log(`${orphan.sessionID}: ${orphan.reason} - ${orphan.age}ms old`)
}
```

### `cleanup(input)`

Clean up a single orphaned session.

```typescript
// Archive (default)
await OrphanDetector.cleanup({
  sessionID: "session-123",
  reason: "no_activity",
})

// Delete permanently
await OrphanDetector.cleanup({
  sessionID: "session-123",
  delete: true,
  reason: "parent_deleted",
})
```

### `cleanupBatch(input)`

Clean up multiple orphaned sessions.

```typescript
const orphans = await OrphanDetector.detect()
await OrphanDetector.cleanupBatch({
  orphans,
  delete: false,  // Archive all
  reason: "bulk_cleanup",
})
```

### `getStats(options?)`

Get statistics about orphaned sessions.

```typescript
const stats = await OrphanDetector.getStats({
  noActivityDays: 7,
})

console.log(`Total orphans: ${stats.total}`)
console.log(`By reason: ${JSON.stringify(stats.byReason)}`)
console.log(`By age: ${JSON.stringify(stats.byAgeBucket)}`)
```

## Events

### `session.handoff.created`

Fired when a handoff prompt is created.

```typescript
Bus.event.listen((event) => {
  if (event.type === "session.handoff.created") {
    console.log(`Handoff created: ${event.properties.handoff.id}`)
  }
})
```

### `session.orphan.detected`

Fired when orphaned sessions are detected.

```typescript
Bus.event.listen((event) => {
  if (event.type === "session.orphan.detected") {
    console.log(`Found ${event.properties.orphans.length} orphans`)
  }
})
```

### `session.orphan.cleaned`

Fired when an orphan is cleaned up.

```typescript
Bus.event.listen((event) => {
  if (event.type === "session.orphan.cleaned") {
    console.log(`Cleaned ${event.properties.sessionID}: ${event.properties.reason}`)
  }
})
```

## REST API Endpoints

### Create Handoff

```http
POST /api/session/:sessionID/handoff
Content-Type: application/json

{
  "summary": "Implemented feature X",
  "todos": [
    { "content": "Add tests", "status": "pending", "priority": "high" }
  ],
  "context": ["src/feature/x.ts"]
}
```

### Resume from Handoff

```http
POST /api/session/handoff/resume
Content-Type: application/json

{
  "handoff": { ... },
  "title": "Continued: Feature X"
}
```

### Detect Orphans

```http
GET /api/session/orphan/detect?noActivityDays=7
```

### Cleanup Orphan

```http
POST /api/session/orphan/cleanup
Content-Type: application/json

{
  "sessionID": "session-123",
  "delete": false,
  "reason": "no_activity"
}
```

### Get Orphan Stats

```http
GET /api/session/orphan/stats?noActivityDays=7
```

## Integration Points

1. **TUI**: Show handoff creation option in session menu
2. **Session Processor**: Auto-generate handoff on session end
3. **Cleanup Job**: Periodic orphan detection (future: cron-based)
4. **CLI Commands**: Direct handoff/orphan management

## Example: End-of-Day Handoff

```typescript
import { SessionHandoff } from "@/session/handoff"
import { Todo } from "@/session/todo"

// At end of work day, create handoff for tomorrow
async function endOfDayHandoff(sessionID: string) {
  const todos = Todo.get(sessionID)
  const pendingTodos = todos.filter(t => t.status === "pending" || t.status === "in_progress")
  
  const handoff = await SessionHandoff.create({
    sessionID,
    summary: `Work completed on ${new Date().toISOString()}`,
    todos: pendingTodos.map(t => ({
      content: t.content,
      status: t.status,
      priority: t.priority,
    })),
  })
  
  console.log(`Handoff created: ${handoff.id}`)
  return handoff
}
```

## Example: Weekly Orphan Cleanup

```typescript
import { OrphanDetector } from "@/session/orphan"

// Run weekly to clean up old sessions
async function weeklyCleanup() {
  const orphans = await OrphanDetector.detect({
    noActivityDays: 7,
  })
  
  console.log(`Found ${orphans.length} orphaned sessions`)
  
  // Archive old sessions (don't delete by default)
  const results = await OrphanDetector.cleanupBatch({
    orphans,
    delete: false,
    reason: "weekly_cleanup",
  })
  
  const archived = results.filter(r => r.action === "archived").length
  console.log(`Archived ${archived} sessions`)
}
```

## Best Practices

1. **Create handoffs at natural breakpoints**: End of day, after completing a milestone, before context switching.

2. **Include meaningful context**: List the key files, decisions, and pending questions that the next session needs.

3. **Review todos before handoff**: Ensure todos accurately reflect remaining work with correct priorities.

4. **Archive before delete**: Use archive by default for orphans - you can always delete later if needed.

5. **Monitor orphan stats**: Regular checks help identify patterns (e.g., sessions that consistently become orphans).

6. **Set appropriate noActivityDays**: Adjust based on your workflow - daily users might use 3-7 days, occasional users might need 14-30 days.

## File Structure

```
src/session/
  handoff.ts      - Session handoff creation and resume
  orphan.ts       - Orphan detection and cleanup
  todo.ts         - Todo management (used by handoff)
  index.ts        - Main session module (exports handoff/orphan)
```
