import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import { dispatchRegistryCommand } from './cli';
import { loadRegistry, _resetLoader } from './registry/index';
import { register, defineCommand } from './registry/registry';

describe('cli registry dispatch', () => {
  beforeEach(() => _resetLoader());
  afterEach(() => _resetLoader());

  it('runs a registered command and returns handled=true', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'demo-cli',
      summary: 'demo command',
      args: z.object({}),
      async run() {
        return { ok: true, summary: 'demo ran', data: null };
      },
    }));
    const out: string[] = [];
    const handled = await dispatchRegistryCommand('demo-cli', [], s => out.push(s));
    expect(handled).toBeTruthy();
    expect(out.join('')).toMatch(/demo ran/);
  });

  it('returns handled=false for an unknown command', async () => {
    const handled = await dispatchRegistryCommand('nonsense-xyz', [], () => {});
    expect(handled).toBeFalsy();
  });
});
