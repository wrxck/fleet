import { createServer, connect, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { describe, it, expect, afterEach } from 'vitest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { handleConnection } from './daemon';
import { Guard, DEFAULT_POLICY, type AuditEntry } from './guard';

// drives a real client connection against handleConnection over a tmp unix
// socket (bindable without root), exercising transport + guarded server + guard.
describe('daemon connection (integration)', () => {
  let server: Server | undefined;
  let sockPath = '';

  afterEach(() => {
    server?.close();
    if (sockPath) { try { rmSync(sockPath); } catch { /* gone already */ } }
  });

  it('handshakes, lists tools, and denies a destructive call end-to-end', async () => {
    const log: AuditEntry[] = [];
    const guard = new Guard({ policy: DEFAULT_POLICY, now: () => 1, auditSink: (e) => log.push(e) });
    sockPath = join(tmpdir(), `fleet-mcp-it-${process.pid}-${Math.floor(Math.random() * 1e6)}.sock`);
    server = createServer((s) => handleConnection(guard, s));
    await new Promise<void>((r) => server!.listen(sockPath, r));

    const client = connect(sockPath);
    const waiters = new Map<number, (v: Record<string, never>) => void>();
    let buf = '';
    client.on('data', (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id != null) waiters.get(msg.id)?.(msg);
      }
    });
    await new Promise<void>((r) => client.on('connect', () => r()));

    const send = (o: unknown) => client.write(JSON.stringify(o) + '\n');
    const rpc = (o: { id: number; [k: string]: unknown }): Promise<{ result: Record<string, never> }> =>
      new Promise((res) => { waiters.set(o.id, res as never); send(o); });

    const init = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '0' } },
    }) as never as { result: { serverInfo: { name: string }; protocolVersion: string } };
    expect(init.result.serverInfo.name).toBe('fleet');
    // the daemon must negotiate the latest protocol the sdk supports, not an older one.
    expect(init.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as never as {
      result: { tools: { name: string }[] };
    };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toContain('fleet_status');
    expect(names).toContain('fleet_deploy');

    const call = await rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'fleet_deploy', arguments: { app: 'no-such-app' } },
    }) as never as { result: { content: { text: string }[] } };
    expect(call.result.content[0].text).toMatch(/Denied by fleet guard/);
    expect(log.some((e) => e.tool === 'fleet_deploy' && e.outcome === 'deny')).toBeTruthy();

    client.end();
  });
});
