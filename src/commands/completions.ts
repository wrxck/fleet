import { z } from 'zod';

import { allCommands, defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export type Shell = 'bash' | 'zsh' | 'fish';

export interface CompletionsData {
  shell: Shell;
  script: string;
}

// commands still living in the legacy switch in cli.ts. tracked separately
// from the registry so completions stay accurate during the migration;
// shrinks toward [] as each migration commit lands.
const LEGACY_COMMANDS: readonly string[] = [
  'logs', 'egress', 'deps', 'audit', 'testflight', 'deploy', 'nginx', 'secrets',
  'git', 'watchdog', 'guard', 'backup', 'routines', 'routine-run',
  'tui', 'dashboard', 'mcp',
];

/** lazy-import loadRegistry to dodge the circular: registry/index imports this
 *  module (to register the command), and this module needs the registry to be
 *  populated before allCommands() is called. importing index at call-time
 *  lets node finish evaluating both modules first. */
async function collectCommandNames(): Promise<string[]> {
  const { loadRegistry } = await import('../registry/index');
  loadRegistry();
  const registered = allCommands().map(c => c.name);
  return Array.from(new Set([...registered, ...LEGACY_COMMANDS])).sort();
}

function bashScript(names: string[]): string {
  // tab completion entry-point — sourced from ~/.bashrc:
  //   eval "$(fleet completions bash)"
  return `# fleet bash completions — install with: eval "$(fleet completions bash)"
_fleet_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${names.join(' ')}" -- "$cur") )
  fi
  return 0
}
complete -F _fleet_completions fleet
`;
}

function zshScript(names: string[]): string {
  return `# fleet zsh completions — install with: eval "$(fleet completions zsh)"
_fleet() {
  local -a commands
  commands=(${names.map(n => `'${n}'`).join(' ')})
  if [ \${CURRENT} -eq 2 ]; then
    _describe 'command' commands
  fi
}
compdef _fleet fleet
`;
}

function fishScript(names: string[]): string {
  // fish reads completions from ~/.config/fish/completions/fleet.fish:
  //   fleet completions fish > ~/.config/fish/completions/fleet.fish
  const lines = names.map(n => `complete -c fleet -f -n '__fish_use_subcommand' -a '${n}'`);
  return `# fleet fish completions — install with:
#   fleet completions fish > ~/.config/fish/completions/fleet.fish
${lines.join('\n')}
`;
}

export const completionsCommand = defineCommand({
  name: 'completions',
  summary: 'Emit shell completion script for bash, zsh, or fish',
  cliOnly: true,
  args: z.object({
    shell: z.enum(['bash', 'zsh', 'fish']),
  }),
  async run(args, _ctx): Promise<CommandResult<CompletionsData>> {
    const names = await collectCommandNames();
    let script: string;
    switch (args.shell) {
      case 'bash':
        script = bashScript(names);
        break;
      case 'zsh':
        script = zshScript(names);
        break;
      case 'fish':
        script = fishScript(names);
        break;
    }
    return {
      ok: true,
      summary: script,
      data: { shell: args.shell, script },
    };
  },
});
