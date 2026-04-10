---
name: mcp-adobe-setup
description: Quick setup guide for Adobe Creative Suite MCP servers
agent: build
---

Set up Adobe Creative Suite MCP servers for After Effects, Photoshop, Illustrator, InDesign, and XD.

## Prerequisites

### All Platforms
1. Install Adobe Creative Cloud applications
2. Ensure the applications are running before using MCP tools

### Windows
- Photoshop: Requires Adobe Photoshop CC 2017-2024
- After Effects: Requires AE 2022 or later
- Adobe XD: Requires XD installed

### macOS
- After Effects: Requires AE 2022 or later
- Illustrator: Requires Illustrator installed
- InDesign: Requires InDesign 2025 or later
- Adobe XD: Requires XD installed

## Quick Setup

### 1. Install Adobe Suite Bundle
```
HopCoderX mcp setup adobe-suite
```

This will install all compatible Adobe MCP servers for your platform.

### 2. Install Individual Servers

**After Effects (Windows & macOS):**
```
HopCoderX mcp install after-effects
```

**Photoshop (Windows only):**
```
HopCoderX mcp install photoshop
```

**Illustrator (macOS only):**
```
HopCoderX mcp install illustrator
```

**InDesign (macOS only):**
```
HopCoderX mcp install indesign
```

**Adobe XD (All platforms):**
```
HopCoderX mcp install adobe-xd
```

### 3. Enable Servers

After installation, enable the servers:
```
HopCoderX mcp list
# Then press Space on each server to toggle it on
```

Or edit your `hopcoderx.json` and set `enabled: true` for each server.

## Post-Installation

### After Effects
1. Clone the repository locally
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Install AE panel: `npm run install-bridge`

### Photoshop
1. Install `uv` if not present: `curl -LsSf https://astral.sh/uv/install.sh | sh`
2. Set `PS_VERSION` environment variable (e.g., "2024")

### Illustrator
1. Ensure Python 3.x with `uv` is installed
2. Clone repository to known location

### InDesign
1. Ensure Node.js 18+ is installed
2. Clone repository and install dependencies

### Adobe XD
1. Build the project: `npm run build`
2. Point config to `dist/index.js`

## Usage

Once enabled, you can use these commands in your HopCoderX sessions:

- "Create a new After Effects composition with 3 layers"
- "Photoshop: open file.jpg and apply a blur filter"
- "Illustrator: create a vector logo with the brand name"
- "Export my InDesign document as PDF"
- "Generate React components from this XD design"

## Troubleshooting

**MCP server not connecting:**
- Ensure the Adobe application is running
- Check that all dependencies are installed
- Verify the command path in your config matches your installation

**Platform compatibility errors:**
- Some Adobe apps are platform-specific (Photoshop=Windows, Illustrator/InDesign=macOS)
- Use `HopCoderX mcp registry` to see compatible servers for your platform

**Authentication required:**
- Run `HopCoderX mcp auth <server-name>` for OAuth-enabled servers

For more help, run: `HopCoderX mcp --help`
