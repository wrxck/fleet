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

  it('renders structured data as json with --json', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'demo-json',
      summary: 'demo json command',
      args: z.object({}),
      async run() {
        return { ok: true, summary: 'human summary', data: { count: 2 } };
      },
    }));
    const out: string[] = [];
    await dispatchRegistryCommand('demo-json', ['--json'], s => out.push(s));
    expect(out.join('')).toContain('"count": 2');
  });

  it('reports a parse error and sets a non-zero exit code', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'demo-args',
      summary: 'demo command with a required arg',
      args: z.object({ app: z.string() }),
      async run() {
        return { ok: true, summary: 'ran', data: null };
      },
    }));
    const original = process.exitCode;
    const handled = await dispatchRegistryCommand('demo-args', [], () => {});
    expect(handled).toBeTruthy();
    expect(process.exitCode).toBe(1);
    process.exitCode = original;
  });
});
