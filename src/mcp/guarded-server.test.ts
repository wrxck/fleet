import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { guarded } from './guarded-server';
import { Guard, DEFAULT_POLICY, type AuditEntry } from './guard';

// fake mcp server that just records what tool() is called with, so we can invoke
// the (wrapped) handler the proxy installed.
function fakeServer() {
  const registrations: unknown[][] = [];
  const srv = {
    registrations,
    tool(...args: unknown[]) { registrations.push(args); },
  };
  return srv;
}

function makeGuard(tools: Record<string, 'allow' | 'deny'> = {}) {
  const log: AuditEntry[] = [];
  const guard = new Guard({
    policy: { ...DEFAULT_POLICY, tools },
    now: () => 1,
    auditSink: (e) => log.push(e),
  });
  return { guard, log };
}

type Handler = (...a: unknown[]) => Promise<{ content: { text: string }[] }>;

describe('guarded() proxy', () => {
  it('blocks a denied destructive tool and never calls the original handler', async () => {
    const { guard } = makeGuard();
    const srv = fakeServer();
    let called = false;
    guarded(srv as unknown as McpServer, guard).tool(
      'fleet_deploy', 'desc', {}, async () => { called = true; return { content: [{ text: 'ran' }] }; },
    );
    const wrapped = srv.registrations[0].at(-1) as Handler;
    const res = await wrapped({ app: 'x' }, { signal: undefined });
    expect(called).toBeFalsy();
    expect(res.content[0].text).toMatch(/Denied by fleet guard/);
  });

  it('runs an allowed tool and audits its completion', async () => {
    const { guard, log } = makeGuard();
    const srv = fakeServer();
    guarded(srv as unknown as McpServer, guard).tool(
      'fleet_status', 'desc', async () => ({ content: [{ text: 'ok' }] }),
    );
    const wrapped = srv.registrations[0].at(-1) as Handler;
    const res = await wrapped({ signal: undefined }); // no-arg tool: handler gets only `extra`
    expect(res.content[0].text).toBe('ok');
    expect(log.at(-1)).toMatchObject({ tool: 'fleet_status', outcome: 'allow' });
  });

  it('extracts tool args only when the handler receives args + extra', async () => {
    const { guard, log } = makeGuard({ fleet_secrets_set: 'allow' });
    const srv = fakeServer();
    guarded(srv as unknown as McpServer, guard).tool(
      'fleet_secrets_set', 'desc', {}, async () => ({ content: [{ text: 'set' }] }),
    );
    const wrapped = srv.registrations[0].at(-1) as Handler;
    await wrapped({ app: 'a', key: 'K', value: 'SEKRET' }, { signal: undefined });
    const entry = log.at(-1)!;
    expect(entry.args).toMatchObject({ app: 'a', key: 'K', value: '[redacted]' });
    expect(JSON.stringify(entry)).not.toContain('SEKRET');
  });
});

function harness(handlers: Map<string, (...a: unknown[]) => unknown>) {
  return {
    tool(name: string, ...rest: unknown[]) {
      handlers.set(name, rest[rest.length - 1] as (...a: unknown[]) => unknown);
    },
  } as unknown as McpServer;
}

describe('guarded-server audit accuracy', () => {
  it('records an isError result as outcome=error with scrubbed text', async () => {
    const entries: AuditEntry[] = [];
    const guard = new Guard({
      policy: { tiers: { read: 'allow', mutate: 'allow', destructive: 'allow' }, tools: {}, rateLimits: { read: 0, mutate: 0, destructive: 0 } },
      auditSink: (e) => entries.push(e),
    });
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const server = guarded(harness(handlers), guard);
    server.tool('fleet_deploy', 'x', { app: () => {} }, async () => ({
      content: [{ type: 'text', text: 'build failed: DB_PASSWORD=hunter2hunter2hunter2hunter2' }],
      isError: true,
    }));
    await handlers.get('fleet_deploy')!({ app: 'nutrition' }, {});
    const err = entries.find(e => e.tool === 'fleet_deploy' && e.outcome === 'error');
    expect(err).toBeDefined();
    expect(err!.error).toBeDefined();
    expect(err!.error).not.toContain('hunter2hunter2hunter2');
  });

  it('records a normal result as outcome=allow', async () => {
    const entries: AuditEntry[] = [];
    const guard = new Guard({
      policy: { tiers: { read: 'allow', mutate: 'allow', destructive: 'allow' }, tools: {}, rateLimits: { read: 0, mutate: 0, destructive: 0 } },
      auditSink: (e) => entries.push(e),
    });
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const server = guarded(harness(handlers), guard);
    server.tool('fleet_list', 'x', async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    await handlers.get('fleet_list')!({});
    expect(entries.find(e => e.tool === 'fleet_list')!.outcome).toBe('allow');
  });
});
