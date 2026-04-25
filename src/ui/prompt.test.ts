import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable, PassThrough } from 'node:stream';
import { promptHiddenBuffer, withSecretBuffer, promptHidden } from './prompt.js';

// All of these tests exercise the non-TTY path (process.stdin.isTTY === false
// in vitest), which uses the readline fallback with terminal:false. The TTY
// raw-mode path is exercised manually + tracked separately.

function feedStdin(text: string): void {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream;
  // @ts-expect-error — we intentionally swap the stdin stream
  Object.defineProperty(stream, 'isTTY', { value: false });
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true });
  process.nextTick(() => {
    (stream as unknown as PassThrough).write(text);
    (stream as unknown as PassThrough).end();
  });
}

const realStdin = process.stdin;
afterEach(() => {
  Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true });
});

describe('promptHiddenBuffer', () => {
  it('returns input as a Buffer', async () => {
    feedStdin('sk_live_abc\n');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const buf = await promptHiddenBuffer('paste');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('sk_live_abc');
    writeSpy.mockRestore();
  });

  it('rejects on stdin close before line', async () => {
    const stream = new PassThrough() as unknown as NodeJS.ReadStream;
    Object.defineProperty(stream, 'isTTY', { value: false });
    Object.defineProperty(process, 'stdin', { value: stream, configurable: true });
    process.nextTick(() => (stream as unknown as PassThrough).end());
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(promptHiddenBuffer('paste')).rejects.toThrow(/Cancelled/);
    writeSpy.mockRestore();
  });
});

describe('withSecretBuffer', () => {
  it('zeros the buffer after the callback returns', async () => {
    feedStdin('hunter2\n');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let captured!: Buffer;
    await withSecretBuffer('paste', async (buf) => {
      captured = buf;
      expect(buf.toString('utf8')).toBe('hunter2');
    });
    // After return, the buffer must be zeroed.
    expect(captured.every(b => b === 0)).toBe(true);
    writeSpy.mockRestore();
  });

  it('zeros the buffer even when the callback throws', async () => {
    feedStdin('hunter2\n');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let captured!: Buffer;
    await expect(withSecretBuffer('paste', async (buf) => {
      captured = buf;
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(captured.every(b => b === 0)).toBe(true);
    writeSpy.mockRestore();
  });
});

describe('promptHidden (string convenience)', () => {
  it('returns string and zeros the underlying buffer', async () => {
    feedStdin('value\n');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const value = await promptHidden('paste');
    expect(value).toBe('value');
    writeSpy.mockRestore();
  });
});
