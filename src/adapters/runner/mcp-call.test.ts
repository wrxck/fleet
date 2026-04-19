import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { RunEvent } from '../../core/routines/schema.js';
import type { RunContext } from '../types.js';
import { mkExecTmpDir, rmExecTmpDir } from '../../core/routines/test-utils.js';
import { createMcpCallRunner } from './mcp-call.js';

const makeCtx = (dir: string): RunContext => ({
  repo: null,
  repoPath: null,
  runId: 'run-1',
  routineId: 'r-mcp',
  startedAt: new Date().toISOString(),
  logsDir: dir,
  env: {},
});

const MCP_SERVER_SCRIPT = `#!/usr/bin/env node
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    respond(msg);
  }
});
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}
function respond(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-fleet', version: '1.0.0' },
    }});
  } else if (msg.method === 'notifications/initialized') {
    // no reply expected
  } else if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (name === 'fleet_status') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: 'all good' }],
        isError: false,
      }});
    } else if (name === 'fleet_fail') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: 'nope' }],
        isError: true,
      }});
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such tool' }});
    }
  }
}
`;

describe('mcp-call runner', () => {
  let dir: string;
  let serverPath: string;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-mcp-');
    serverPath = join(dir, 'fake-mcp-server.mjs');
    writeFileSync(serverPath, MCP_SERVER_SCRIPT, { mode: 0o755 });
    chmodSync(serverPath, 0o755);
  });

  afterEach(() => {
    rmExecTmpDir(dir);
  });

  it('calls a tool via stdio and emits stdout + end=ok', async () => {
    const runner = createMcpCallRunner({ command: 'node', args: [serverPath] });
    const events: RunEvent[] = [];
    for await (const ev of runner.run(
      { kind: 'mcp-call', tool: 'fleet_status', args: { summary: true }, wallClockMs: 5000 },
      makeCtx(dir),
      new AbortController().signal,
    )) events.push(ev);

    const stdoutText = events.filter(e => e.kind === 'stdout').map(e => (e.kind === 'stdout' ? e.chunk : '')).join('');
    expect(stdoutText).toContain('all good');
    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') {
      expect(end.status).toBe('ok');
      expect(end.exitCode).toBe(0);
    }
  }, 10_000);

  it('reports failed when tool returns isError', async () => {
    const runner = createMcpCallRunner({ command: 'node', args: [serverPath] });
    const events: RunEvent[] = [];
    for await (const ev of runner.run(
      { kind: 'mcp-call', tool: 'fleet_fail', args: {}, wallClockMs: 5000 },
      makeCtx(dir),
      new AbortController().signal,
    )) events.push(ev);

    const end = events[events.length - 1];
    expect(end?.kind).toBe('end');
    if (end?.kind === 'end') {
      expect(end.status).toBe('failed');
      expect(end.error ?? '').toBeTruthy();
    }
  }, 10_000);

  it('reports failed when tool does not exist', async () => {
    const runner = createMcpCallRunner({ command: 'node', args: [serverPath] });
    const events: RunEvent[] = [];
    for await (const ev of runner.run(
      { kind: 'mcp-call', tool: 'nonexistent', args: {}, wallClockMs: 5000 },
      makeCtx(dir),
      new AbortController().signal,
    )) events.push(ev);
    const end = events[events.length - 1];
    if (end?.kind === 'end') {
      expect(end.status).toBe('failed');
      expect(end.error ?? '').toContain('no such tool');
    }
  }, 10_000);
});
