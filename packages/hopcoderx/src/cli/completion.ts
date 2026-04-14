/**
 * Smart autocomplete for HopCoderX CLI.
 *
 * Features:
 *   - Dynamic completion from MCP servers
 *   - Context-aware suggestions
 *   - Fuzzy matching for commands and files
 *   - Shell integration (bash, zsh, fish, pwsh)
 */

import fuzzysort from "fuzzysort"
import { TopLevelCompletionCommands, CommandTaxonomy } from "./command-taxonomy"
import { McpRegistry } from "../mcp/registry"
import { Skill } from "../skill"
import { Agent } from "../agent/agent"
import path from "path"
import { Glob } from "../util/glob"

export interface CompletionItem {
  label: string
  value: string
  type: "command" | "file" | "skill" | "agent" | "mcp" | "flag"
  description?: string
  score?: number
}

export interface CompletionContext {
  cwd: string
  argv: string[]
  position: number // Position in argv where completion is requested
}

// ─── Command Completion ───────────────────────────────────────────────────────

export function completeCommands(query: string, limit = 20): CompletionItem[] {
  const items: CompletionItem[] = []

  // Add top-level commands
  for (const cmd of TopLevelCompletionCommands) {
    items.push({
      label: cmd,
      value: cmd,
      type: "command",
      description: getCommandDescription(cmd),
    })
  }

  // Add subcommands
  for (const group of CommandTaxonomy) {
    for (const cmd of group.completion) {
      items.push({
        label: `${group.name} ${cmd}`,
        value: `${group.name} ${cmd}`,
        type: "command",
        description: group.title,
      })
    }
  }

  // Fuzzy search
  if (query) {
    const results = fuzzysort.go(query, items, {
      key: "label",
      limit,
      threshold: -10000,
    })
    return results.map((r) => ({ ...r.target, score: r.score }))
  }

  return items.slice(0, limit)
}

function getCommandDescription(cmd: string): string {
  const group = CommandTaxonomy.find((g) => g.completion.includes(cmd) || g.name === cmd)
  return group?.title || "Command"
}

// ─── Flag Completion ──────────────────────────────────────────────────────────

const COMMON_FLAGS = [
  { flag: "--help", alias: "-h", description: "Show help" },
  { flag: "--version", alias: "-v", description: "Show version" },
  { flag: "--verbose", description: "Enable verbose output" },
  { flag: "--quiet", alias: "-q", description: "Suppress output" },
  { flag: "--json", description: "Output as JSON" },
  { flag: "--format", description: "Output format" },
  { flag: "--config", description: "Config file path" },
  { flag: "--global", alias: "-g", description: "Global scope" },
  { flag: "--dry-run", description: "Preview without applying" },
  { flag: "--force", alias: "-f", description: "Force operation" },
]

export function completeFlags(query: string): CompletionItem[] {
  const items: CompletionItem[] = COMMON_FLAGS.map((f) => ({
    label: f.flag,
    value: f.flag,
    type: "flag",
    description: f.description,
  }))

  if (query.startsWith("-")) {
    return fuzzysort
      .go(query, items, { key: "label", threshold: -10000 })
      .map((r) => ({ ...r.target, score: r.score }))
  }

  return items
}

// ─── File Completion ──────────────────────────────────────────────────────────

export async function completeFiles(
  query: string,
  cwd: string,
  extensions?: string[],
  limit = 50,
): Promise<CompletionItem[]> {
  try {
    // Handle partial paths
    const dir = path.dirname(query) || "."
    const base = path.basename(query)

    const pattern = extensions && extensions.length > 0
      ? `${dir}/**/*.{${extensions.join(",")}}`
      : `${dir}/*`

    const matches = await Glob.scan(pattern, {
      cwd,
      absolute: false,
      include: "file",
      dot: false,
    })

    const items: CompletionItem[] = matches
      .filter((m) => !base || path.basename(m).startsWith(base))
      .slice(0, limit)
      .map((m) => ({
        label: m,
        value: m,
        type: "file",
        description: path.extname(m).slice(1).toUpperCase() + " file",
      }))

    // Fuzzy sort if query provided
    if (query && items.length > 0) {
      const results = fuzzysort.go(query, items, {
        key: "label",
        threshold: -5000,
      })
      return results.map((r) => ({ ...r.target, score: r.score }))
    }

    return items
  } catch {
    return []
  }
}

// ─── Skill Completion ─────────────────────────────────────────────────────────

export async function completeSkills(query: string): Promise<CompletionItem[]> {
  try {
    const skills = await Skill.list()
    const items: CompletionItem[] = skills.map((s) => ({
      label: s.name,
      value: s.name,
      type: "skill",
      description: s.description,
    }))

    if (query) {
      const results = fuzzysort.go(query, items, {
        key: "label",
        threshold: -10000,
      })
      return results.map((r) => ({ ...r.target, score: r.score }))
    }

    return items
  } catch {
    return []
  }
}

// ─── Agent Completion ─────────────────────────────────────────────────────────

export async function completeAgents(query: string): Promise<CompletionItem[]> {
  try {
    const agents = await Agent.list()
    const items: CompletionItem[] = agents.map((a) => ({
      label: a.name,
      value: a.name,
      type: "agent",
      description: a.description || `Mode: ${a.mode}`,
    }))

    if (query) {
      const results = fuzzysort.go(query, items, {
        key: "label",
        threshold: -10000,
      })
      return results.map((r) => ({ ...r.target, score: r.score }))
    }

    return items
  } catch {
    return []
  }
}

// ─── MCP Server Completion ────────────────────────────────────────────────────

export async function completeMcpServers(query: string): Promise<CompletionItem[]> {
  try {
    const servers = McpRegistry.all()
    const items: CompletionItem[] = servers.map((s) => ({
      label: s.name,
      value: s.name,
      type: "mcp",
      description: s.description || `${s.type} server`,
    }))

    if (query) {
      const results = fuzzysort.go(query, items, {
        key: "label",
        threshold: -10000,
      })
      return results.map((r) => ({ ...r.target, score: r.score }))
    }

    return items
  } catch {
    return []
  }
}

// ─── Context-Aware Completion ─────────────────────────────────────────────────

export async function complete(
  context: CompletionContext,
): Promise<CompletionItem[]> {
  const { argv, position, cwd } = context

  // Determine what to complete based on context
  const current = argv[position] || ""
  const prev = argv[position - 1] || ""

  // Completing a flag
  if (current.startsWith("-")) {
    return completeFlags(current)
  }

  // Completing after a command that takes a file argument
  const fileCommands = ["read", "write", "edit", "open", "import", "export"]
  if (fileCommands.some((c) => argv.includes(c))) {
    const files = await completeFiles(current, cwd)
    if (files.length > 0) return files
  }

  // Completing after "mcp" command - suggest server names
  if (prev === "mcp" || argv[0] === "mcp") {
    const mcps = await completeMcpServers(current)
    if (mcps.length > 0) return mcps
  }

  // Completing after "skill" command
  if (prev === "skill" || argv[0] === "skill") {
    const skills = await completeSkills(current)
    if (skills.length > 0) return skills
  }

  // Completing after "agent" command
  if (prev === "agent" || argv[0] === "agent") {
    const agents = await completeAgents(current)
    if (agents.length > 0) return agents
  }

  // Default: complete commands
  return completeCommands(current)
}

// ─── Shell Completion Scripts ─────────────────────────────────────────────────

export function generateShellCompletion(shell: string): string {
  switch (shell) {
    case "bash":
      return BASH_COMPLETION
    case "zsh":
      return ZSH_COMPLETION
    case "fish":
      return FISH_COMPLETION
    case "pwsh":
      return POWERSHELL_COMPLETION
    default:
      return `# Unsupported shell: ${shell}\n# Supported: bash, zsh, fish, pwsh`
  }
}

const BASH_COMPLETION = `# HopCoderX bash completion

_hopcoderx_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Generate completions using hopcoderx
  COMPREPLY=( $(hopcoderx completion bash --cur "\${cur}" --prev "\${prev}" 2>/dev/null) )
}

complete -F _hopcoderx_completion hopcoderx
complete -F _hopcoderx_completion hopcoderx-anthropic-auth
complete -F _hopcoderx_completion hopcoderx-gitlab
`

const ZSH_COMPLETION = `# HopCoderX zsh completion

#compdef hopcoderx

_hopcoderx() {
  local -a completions
  completions=($(hopcoderx completion zsh --cur "\${words[-1]}" --prev "\${words[-2]}" 2>/dev/null))

  if [[ -n "\$completions" ]]; then
    _describe 'hopcoderx' completions
  else
    _arguments \\
      '--help[Show help]' \\
      '--version[Show version]' \\
      '--verbose[Enable verbose output]' \\
      '--json[Output as JSON]' \\
      '--format[Output format]' \\
      '--global[Global scope]' \\
      '--dry-run[Preview without applying]' \\
      '--force[Force operation]'
  fi
}

_hopcoderx
`

const FISH_COMPLETION = `# HopCoderX fish completion

function __hopcoderx_complete
  set -l cur (commandline -ct)
  set -l prev (commandline -cp)

  hopcoderx completion fish --cur "\$cur" --prev "\$prev" 2>/dev/null | string split ' '
end

complete -c hopcoderx -f -a '(__hopcoderx_complete)'
`

const POWERSHELL_COMPLETION = `# HopCoderX PowerShell completion

Register-ArgumentCompleter -Native -CommandName hopcoderx -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $completions = hopcoderx completion pwsh --cur $wordToComplete 2>/dev/null

  if ($completions) {
    $completions -split '\\n' | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new(
        $_,
        $_,
        [System.Management.Automation.CompletionResultType]::ParameterValue,
        $_
      )
    }
  }
}
`

// ─── CLI Completion Command ───────────────────────────────────────────────────

import { cmd } from "./cmd/cmd"
import { UI } from "./ui"
import type { Argv } from "yargs"

export const CompletionCommand = cmd({
  command: "completion <shell>",
  describe: "Generate shell completion script",
  builder: (yargs: Argv) =>
    yargs
      .positional("shell", {
        choices: ["bash", "zsh", "fish", "pwsh"] as const,
        describe: "Shell type",
      })
      .option("cur", {
        type: "string",
        describe: "Current word being completed",
        hide: true,
      })
      .option("prev", {
        type: "string",
        describe: "Previous word",
        hide: true,
      }),
  async handler(args) {
    const shell = args.shell as string

    // If --cur provided, generate dynamic completions
    if (args.cur !== undefined) {
      const context: CompletionContext = {
        cwd: process.cwd(),
        argv: [args.cur, args.prev || ""],
        position: 0,
      }

      const items = await complete(context)
      for (const item of items) {
        console.log(item.value)
      }
      return
    }

    // Otherwise, generate shell completion script
    const script = generateShellCompletion(shell)
    console.log(script)

    if (shell === "bash" || shell === "zsh") {
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + `# To install, run:` + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + `#   hopcoderx completion ${shell} >> ~/.bash_completion` + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_DIM + `#   hopcoderx completion ${shell} > /usr/local/share/zsh/site-functions/_hopcoderx` + UI.Style.TEXT_NORMAL)
    }
  },
})
