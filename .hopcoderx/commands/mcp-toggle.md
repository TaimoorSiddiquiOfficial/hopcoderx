---
name: mcp-toggle
description: Toggle an MCP server on/off
agent: build
---

Toggle an MCP server between enabled and disabled states.

Usage:
- @mcp-toggle <server-name> - Toggle the specified MCP server
- Run without arguments to see a list of available MCP servers

Examples:
- @mcp-toggle railway
- @mcp-toggle after-effects
- @mcp-toggle shopify

This command is useful for quickly enabling or disabling MCP servers
without editing configuration files directly.
