import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import { collectRegistryTools } from './registry-bridge';
import { loadRegistry, _resetLoader } from '../registry/index';
import { register, defineCommand } from '../registry/registry';

describe('mcp registry bridge', () => {
  beforeEach(() => _resetLoader());
  afterEach(() => _resetLoader());

  it('produces a tool descriptor for a registry command', () => {
    loadRegistry();
    register(defineCommand({
      name: 'demo-mcp',
      summary: 'a demo command',
      args: z.object({}),
      async run() { return { ok: true, summary: 'ok', data: null }; },
    }));
    const tools = collectRegistryTools();
    const demo = tools.find(t => t.toolName === 'fleet_demo-mcp');
    expect(demo).toBeDefined();
    expect(demo?.summary).toBe('a demo command');
  });

  it('namespaces subcommands with underscores', () => {
    loadRegistry();
    register(defineCommand({
      name: 'group:sub',
      summary: 'a namespaced command',
      args: z.object({}),
      async run() { return { ok: true, summary: 'ok', data: null }; },
    }));
    expect(collectRegistryTools().some(t => t.toolName === 'fleet_group_sub')).toBeTruthy();
  });

  it('excludes cliOnly commands', () => {
    loadRegistry();
    register(defineCommand({
      name: 'cli-thing',
      summary: 'cli only',
      args: z.object({}),
      cliOnly: true,
      async run() { return { ok: true, summary: 'ok', data: null }; },
    }));
    expect(collectRegistryTools().some(t => t.toolName === 'fleet_cli-thing')).toBeFalsy();
  });
});
