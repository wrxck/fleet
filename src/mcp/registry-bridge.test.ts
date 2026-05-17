import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { collectRegistryTools, registerRegistryTools } from './registry-bridge';
import { loadRegistry, _resetLoader } from '../registry/index';
import { register, defineCommand } from '../registry/registry';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** captures the handlers passed to server.tool so they can be invoked directly. */
function fakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool(name: string, _summary: string, _shape: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

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

describe('registerRegistryTools handler', () => {
  beforeEach(() => _resetLoader());
  afterEach(() => _resetLoader());

  it('surfaces a thrown command as a structured isError result', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'boom',
      summary: 'throws',
      args: z.object({}),
      async run(): Promise<never> { throw new Error('kaboom'); },
    }));
    const { server, handlers } = fakeServer();
    registerRegistryTools(server);
    const result = await handlers.get('fleet_boom')!({}) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBeTruthy();
    expect(result.content[0].text).toBe('kaboom');
  });

  it('stringifies a non-Error throw', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'boom-string',
      summary: 'throws a string',
      args: z.object({}),
      // eslint-disable-next-line no-throw-literal
      async run(): Promise<never> { throw 'plain string failure'; },
    }));
    const { server, handlers } = fakeServer();
    registerRegistryTools(server);
    const result = await handlers.get('fleet_boom-string')!({}) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBeTruthy();
    expect(result.content[0].text).toBe('plain string failure');
  });

  it('omits structuredContent for non-object data', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'scalar',
      summary: 'returns a scalar',
      args: z.object({}),
      async run() { return { ok: true, summary: 'done', data: null }; },
    }));
    const { server, handlers } = fakeServer();
    registerRegistryTools(server);
    const result = await handlers.get('fleet_scalar')!({}) as Record<string, unknown>;
    expect(result).not.toHaveProperty('structuredContent');
    expect(result.isError).toBeFalsy();
  });

  it('attaches structuredContent when data is an object', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'objy',
      summary: 'returns an object',
      args: z.object({}),
      async run() { return { ok: true, summary: 'done', data: { count: 2 } }; },
    }));
    const { server, handlers } = fakeServer();
    registerRegistryTools(server);
    const result = await handlers.get('fleet_objy')!({}) as { structuredContent: { count: number } };
    expect(result.structuredContent).toEqual({ count: 2 });
  });

  it('rejects args that fail the command schema', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'needs-app',
      summary: 'requires an app arg',
      args: z.object({ app: z.string() }),
      async run(args) { return { ok: true, summary: `app=${args.app}`, data: null }; },
    }));
    const { server, handlers } = fakeServer();
    registerRegistryTools(server);

    const bad = await handlers.get('fleet_needs-app')!({}) as { isError: boolean; content: Array<{ text: string }> };
    expect(bad.isError).toBeTruthy();
    expect(bad.content[0].text).toContain('app');

    const good = await handlers.get('fleet_needs-app')!({ app: 'web' }) as { isError: boolean; content: Array<{ text: string }> };
    expect(good.isError).toBeFalsy();
    expect(good.content[0].text).toBe('app=web');
  });

  it('applies schema defaults before running, matching the cli surface', async () => {
    loadRegistry();
    register(defineCommand({
      name: 'has-default',
      summary: 'has a defaulted flag',
      args: z.object({ verbose: z.boolean().default(false) }),
      async run(args) { return { ok: true, summary: `verbose=${args.verbose}`, data: null }; },
    }));
    const { server, handlers } = fakeServer();
    registerRegistryTools(server);
    const result = await handlers.get('fleet_has-default')!({}) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('verbose=false');
  });
});
