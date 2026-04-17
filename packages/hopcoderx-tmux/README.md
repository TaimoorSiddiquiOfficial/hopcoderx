# hopcoderx-tmux

[![npm version](https://img.shields.io/npm/v/hopcoderx-tmux.svg)](https://www.npmjs.com/package/hopcoderx-tmux)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Tmux integration plugin for [HopCoderX](https://hopcoder.dev). Automatically spawns a terminal pane when an agent session starts so you can watch live output without leaving your current window.

Inspired by [opentmux](https://github.com/AnganSamadder/opentmux).

## Features

- **Automatic pane spawning** — when any agent session starts, spawns a pane running `hopcoderx attach`
- **Auto-cleanup** — pane is closed when the session ends (configurable)
- **Cross-platform**
  - Linux / macOS: native tmux support
  - Windows: Windows Terminal (`wt.exe`) or PowerShell fallback
- **Configurable layout** — choose `main-vertical`, `tiled`, `even-horizontal`, etc.

## Installation

### Let HopCoderX install it

```bash
hopcoderx hub install hopcoderx-tmux
```

### Manual

1. Install the npm package globally (or add to your project):

```bash
npm install -g hopcoderx-tmux
```

2. Add to your `hopcoderx.json` config:

```json
{
  "plugin": ["hopcoderx-tmux"]
}
```

3. Restart HopCoderX. On next agent session start you'll see a new pane.

## Configuration

Create `~/.config/hopcoderx/opentmux.json` (Windows: `%APPDATA%\hopcoderx\opentmux.json`):

```json
{
  "enabled": true,
  "layout": "main-vertical",
  "main_pane_size": 60,
  "auto_close": true
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `layout` | string | `"main-vertical"` | Tmux layout: `main-horizontal`, `main-vertical`, `tiled`, `even-horizontal`, `even-vertical` |
| `main_pane_size` | number | `60` | Size of main pane as percentage (20–80%) |
| `auto_close` | boolean | `true` | Auto-close panes when sessions complete |
| `port` | number | (auto) | HopCoderX server port override |

## CLI

```bash
hopcoderx tmux status    # Show plugin state, detected platform, and current config
```

## Platform notes

### Linux / macOS

Requires `tmux` to be installed:

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt install tmux
```

If you run `hopcoderx` outside a tmux session, the plugin will create a new detached tmux session for the pane. If you're already inside tmux, it splits the current pane vertically.

### Windows

- Prefers **Windows Terminal** (`wt.exe`) — spawns a new split pane in the current terminal instance.
- Falls back to a detached **PowerShell** window if Windows Terminal is not found.

## Troubleshooting

**Panes not spawning?**

1. Run `hopcoderx tmux status` to verify the platform is detected correctly.
2. Check that `tmux` / `wt.exe` is on your `PATH`.
3. Ensure the plugin is listed in your `hopcoderx.json` `plugin` array.

**Panes not closing?**

Set `"auto_close": true` in `opentmux.json`. On Windows Terminal, programmatic pane closing is not supported — the pane will remain open after the session ends.

## License

MIT
