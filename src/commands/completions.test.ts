import { describe, it, expect } from 'vitest';

import { completionsCommand } from './completions';

const ctx = {
  confirm: async () => true,
  log: () => {},
  env: process.env,
};

describe('fleet completions', () => {
  it('emits a bash script with the registered + legacy command names', async () => {
    const args = completionsCommand.args.parse({ shell: 'bash' });
    const r = await completionsCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.data.script).toMatch(/_fleet_completions/);
    expect(r.data.script).toMatch(/complete -F _fleet_completions fleet/);
    // a sampling of registered commands surface in the wordlist
    expect(r.data.script).toMatch(/status/);
    expect(r.data.script).toMatch(/list/);
    // and a sampling of legacy commands too
    expect(r.data.script).toMatch(/secrets/);
    expect(r.data.script).toMatch(/backup/);
  });

  it('emits a zsh script with a describe block', async () => {
    const args = completionsCommand.args.parse({ shell: 'zsh' });
    const r = await completionsCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.data.script).toMatch(/_describe 'command' commands/);
    expect(r.data.script).toMatch(/compdef _fleet fleet/);
  });

  it('emits a fish script with one complete line per command', async () => {
    const args = completionsCommand.args.parse({ shell: 'fish' });
    const r = await completionsCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.data.script).toMatch(/complete -c fleet/);
    // status is a registered command and should appear in the fish script
    expect(r.data.script).toContain("-a 'status'");
  });

  it('rejects an unknown shell at the schema layer', () => {
    expect(() => completionsCommand.args.parse({ shell: 'tcsh' })).toThrow();
  });

  it('is marked cliOnly so it does not register as an MCP tool', () => {
    expect(completionsCommand.cliOnly).toBeTruthy();
  });
});
