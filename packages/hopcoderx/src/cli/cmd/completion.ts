/**
 * Shell completion generator for HopCoderX.
 *
 * `hopcoderx completion bash`    → print bash completion script
 * `hopcoderx completion zsh`     → print zsh completion script
 * `hopcoderx completion fish`    → print fish completion script
 * `hopcoderx completion install` → auto-install for detected shell
 */

import { join } from "path"
import { homedir } from "os"
import { writeFile, readFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { TopLevelCompletionCommands } from "../command-taxonomy"

const BASH_COMPLETION = `# hopcoderx bash completion
_hopcoderx_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${TopLevelCompletionCommands.join(" ")}" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    memory)     COMPREPLY=( $(compgen -W "add search list delete export clear stats" -- "\${cur}") ) ;;
    sandbox)    COMPREPLY=( $(compgen -W "run exec check images" -- "\${cur}") ) ;;
    daemon)     COMPREPLY=( $(compgen -W "install uninstall start stop restart status logs" -- "\${cur}") ) ;;
    cron)       COMPREPLY=( $(compgen -W "add list run delete enable disable history" -- "\${cur}") ) ;;
    webhooks)   COMPREPLY=( $(compgen -W "listen list add delete test logs" -- "\${cur}") ) ;;
    hooks)      COMPREPLY=( $(compgen -W "list init test" -- "\${cur}") ) ;;
    security)   COMPREPLY=( $(compgen -W "audit scan report" -- "\${cur}") ) ;;
    secrets)    COMPREPLY=( $(compgen -W "set get delete list rotate" -- "\${cur}") ) ;;
    doctor)     COMPREPLY=( $(compgen -W "--fix --json" -- "\${cur}") ) ;;
    accessibility|a11y) COMPREPLY=( $(compgen -W "show set reset test" -- "\${cur}") ) ;;
    *)          COMPREPLY=() ;;
  esac
}
complete -F _hopcoderx_completions hopcoderx
`

const ZSH_COMPLETION = `#compdef hopcoderx
# hopcoderx zsh completion

_hopcoderx() {
  local state

  _arguments \\
    '1: :->command' \\
    '*: :->args'

  case \$state in
    command)
      local commands=(${TopLevelCompletionCommands.map((c) => `'${c}'`).join(" ")})
      _describe 'commands' commands ;;
    args)
      case \$words[2] in
        memory)     _values 'action' add search list delete export clear stats ;;
        sandbox)    _values 'action' run exec check images ;;
        daemon)     _values 'action' install uninstall start stop restart status logs ;;
        cron)       _values 'action' add list run delete enable disable history ;;
        webhooks)   _values 'action' listen list add delete test logs ;;
        hooks)      _values 'action' list init test ;;
        security)   _values 'action' audit scan report ;;
        secrets)    _values 'action' set get delete list rotate ;;
        accessibility|a11y) _values 'action' show set reset test ;;
      esac ;;
  esac
}
_hopcoderx
`

const FISH_COMPLETION = `# hopcoderx fish completion
set -l commands ${TopLevelCompletionCommands.join(" ")}

# Top-level commands
complete -c hopcoderx -f -n '__fish_use_subcommand' -a "$commands"

# Sub-commands
complete -c hopcoderx -f -n '__fish_seen_subcommand_from memory'     -a 'add search list delete export clear stats'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from sandbox'    -a 'run exec check images'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from daemon'     -a 'install uninstall start stop restart status logs'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from cron'       -a 'add list run delete enable disable history'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from webhooks'   -a 'listen list add delete test logs'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from hooks'      -a 'list init test'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from security'   -a 'audit scan report'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from secrets'    -a 'set get delete list rotate'
complete -c hopcoderx -f -n '__fish_seen_subcommand_from accessibility a11y' -a 'show set reset test'
`

const SHELL_FILES: Record<string, { script: string; rcFile: string; completionDir: string }> = {
  bash: {
    script: BASH_COMPLETION,
    rcFile: join(homedir(), ".bashrc"),
    completionDir: join(homedir(), ".local", "share", "bash-completion", "completions"),
  },
  zsh: {
    script: ZSH_COMPLETION,
    rcFile: join(homedir(), ".zshrc"),
    completionDir: join(homedir(), ".zsh", "completions"),
  },
  fish: {
    script: FISH_COMPLETION,
    rcFile: "",
    completionDir: join(homedir(), ".config", "fish", "completions"),
  },
}

export const CompletionCommand = cmd({
  command: "completion [shell]",
  describe: "Generate shell completion scripts (bash/zsh/fish)",
  builder: (yargs: Argv) =>
    yargs
      .positional("shell", {
        type: "string",
        choices: ["bash", "zsh", "fish", "install"] as const,
        default: "bash",
      }),
  handler: async (args: { shell?: string }) => {
    const shell = args.shell ?? "bash"

    if (shell === "install") {
      // Auto-detect shell
      const detected = process.env.SHELL?.split("/").pop() ?? "bash"
      const info = SHELL_FILES[detected]
      if (!info) {
        console.error(`Unsupported shell: ${detected}. Supported: bash, zsh, fish`)
        process.exit(1)
      }

      // Write completion file
      await mkdir(info.completionDir, { recursive: true })
      const completionFile = join(info.completionDir, "hopcoderx")
      await writeFile(completionFile, info.script, "utf8")

      // For bash/zsh, add source line to rc if not already there
      if (info.rcFile && existsSync(info.rcFile)) {
        const rc = await readFile(info.rcFile, "utf8")
        const sourceLine = `source "${completionFile}"`
        if (!rc.includes(sourceLine)) {
          await writeFile(info.rcFile, rc + `\n# HopCoderX shell completion\n${sourceLine}\n`, "utf8")
          console.log(`✅ Added to ${info.rcFile}`)
        }
      } else if (detected === "fish") {
        console.log(`✅ Fish completion installed to ${completionFile}`)
      }

      console.log(`✅ Shell completion installed for ${detected}.`)
      console.log(`   Restart your shell or run: source "${completionFile}"`)
      return
    }

    const info = SHELL_FILES[shell]
    if (!info) {
      console.error(`Unsupported shell: ${shell}`)
      process.exit(1)
    }
    process.stdout.write(info.script)
  },
})
