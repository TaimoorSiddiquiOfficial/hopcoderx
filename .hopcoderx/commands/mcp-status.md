---
name: mcp-status
description: "Display status of all configured MCP servers including connection state, authentication requirements, and errors"
agent: build
---

Show the current status of all configured MCP servers.

This command displays:
- Connected servers (✓)
- Disabled servers (○)
- Failed connections (✗)
- Servers needing authentication (⚠)
- Server details and error messages

Usage: @mcp-status

The status is automatically refreshed when you toggle servers on/off
using the MCP management dialog.

See also:
- @mcp-registry - Browse available MCP servers
- @mcp-adobe-setup - Set up Adobe Creative Suite MCPs
- @mcp-toggle - Toggle specific MCP servers
