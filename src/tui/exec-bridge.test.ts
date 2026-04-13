import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

vi.mock('node:url', () => ({
  fileURLToPath: vi.fn().mockReturnValue('/fake/path/exec-bridge.ts'),
}));

import { runFleetCommand, runFleetJson, streamFleetCommand } from './exec-bridge.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runFleetCommand', () => {
  it('resolves with ok=true and output on success', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, 'output text', '');
    });

    const result = await runFleetCommand(['status']);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('output text');
  });

  it('resolves with ok=false and stderr on error', async () => {
    const err = new Error('command failed');
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(err, '', 'error output');
    });

    const result = await runFleetCommand(['status']);
    expect(result.ok).toBe(false);
    expect(result.output).toBe('error output');
  });

  it('falls back to err.message when stderr is empty', async () => {
    const err = new Error('timeout');
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(err, '', '');
    });

    const result = await runFleetCommand(['status']);
    expect(result.ok).toBe(false);
    expect(result.output).toBe('timeout');
  });

  it('passes args to execFile', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, '', '');
    });

    await runFleetCommand(['deploy', '--app', 'myapp']);
    const callArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(callArgs).toContain('deploy');
    expect(callArgs).toContain('--app');
    expect(callArgs).toContain('myapp');
  });
});

describe('runFleetJson', () => {
  it('returns parsed JSON on success', async () => {
    const data = { apps: ['a', 'b'] };
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, JSON.stringify(data), '');
    });

    const result = await runFleetJson<typeof data>(['list']);
    expect(result).toEqual(data);
  });

  it('returns null on command failure', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(new Error('failed'), '', 'err');
    });

    expect(await runFleetJson(['list'])).toBeNull();
  });

  it('returns null when output is not valid JSON', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, 'not json', '');
    });

    expect(await runFleetJson(['list'])).toBeNull();
  });

  it('appends --json to args', async () => {
    mockExecFile.mockImplementation((_bin: string, _args: string[], _opts: object, cb: Function) => {
      cb(null, '{}', '');
    });

    await runFleetJson(['status', '--app', 'myapp']);
    const callArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(callArgs[callArgs.length - 1]).toBe('--json');
  });
});

describe('streamFleetCommand', () => {
  function makeMockChild() {
    const stdoutHandlers: Record<string, Function[]> = {};
    const stderrHandlers: Record<string, Function[]> = {};
    let killed = false;

    const stdout = {
      on: (event: string, cb: Function) => {
        stdoutHandlers[event] = stdoutHandlers[event] ?? [];
        stdoutHandlers[event].push(cb);
      },
    };
    const stderr = {
      on: (event: string, cb: Function) => {
        stderrHandlers[event] = stderrHandlers[event] ?? [];
        stderrHandlers[event].push(cb);
      },
    };

    return {
      stdout, stderr,
      kill: () => { killed = true; },
      emit: (stream: 'stdout' | 'stderr', data: string) => {
        const handlers = stream === 'stdout' ? stdoutHandlers : stderrHandlers;
        for (const cb of (handlers['data'] ?? [])) cb(Buffer.from(data));
      },
      isKilled: () => killed,
    };
  }

  it('returns a handle with kill and onData', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    const handle = streamFleetCommand(['logs', '--app', 'myapp']);
    expect(typeof handle.kill).toBe('function');
    expect(typeof handle.onData).toBe('function');
  });

  it('delivers stdout lines to onData callback', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    const handle = streamFleetCommand(['logs']);
    const lines: string[] = [];
    handle.onData(line => lines.push(line));
    child.emit('stdout', 'line1\nline2\n');
    expect(lines).toContain('line1');
    expect(lines).toContain('line2');
  });

  it('delivers stderr lines to onData callback', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    const handle = streamFleetCommand(['logs']);
    const lines: string[] = [];
    handle.onData(line => lines.push(line));
    child.emit('stderr', 'error line\n');
    expect(lines).toContain('error line');
  });

  it('buffers lines before onData is registered', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    const handle = streamFleetCommand(['logs']);
    // Emit before registering
    child.emit('stdout', 'buffered\n');
    const lines: string[] = [];
    handle.onData(line => lines.push(line));
    expect(lines).toContain('buffered');
  });

  it('kill() terminates the child process', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    const handle = streamFleetCommand(['logs']);
    handle.kill();
    expect(child.isKilled()).toBe(true);
  });

  it('caps buffer at 1000 entries', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    const handle = streamFleetCommand(['logs']);
    // Emit 1200 lines before registering callback
    for (let i = 0; i < 120; i++) {
      child.emit('stdout', Array.from({ length: 10 }, (_, j) => `line${i * 10 + j}`).join('\n') + '\n');
    }
    const lines: string[] = [];
    handle.onData(line => lines.push(line));
    // Should have at most 1000 lines
    expect(lines.length).toBeLessThanOrEqual(1000);
  });
});
