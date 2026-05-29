import { EventEmitter } from 'node:events';

import { describe, it, expect, vi } from 'vitest';

import { SocketServerTransport } from './socket-transport';

// minimal stand-in for a net.Socket: records writes, can emit data/close/error.
class FakeSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;
  write(data: string, cb?: (err?: Error) => void): boolean {
    this.written.push(data);
    cb?.();
    return true;
  }
  end(): void { /* noop */ }
  destroy(): void { this.destroyed = true; this.emit('close'); }
  off(ev: string, fn: (...a: unknown[]) => void): this { return super.off(ev, fn) as this; }
}

const REQ = (id: number) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' });

function makeStarted() {
  const sock = new FakeSocket();
  const t = new SocketServerTransport(sock as never, { maxMessageBytes: 64 });
  const messages: unknown[] = [];
  const errors: Error[] = [];
  t.onmessage = (m) => messages.push(m);
  t.onerror = (e) => errors.push(e);
  void t.start();
  return { sock, t, messages, errors };
}

describe('SocketServerTransport framing', () => {
  it('parses multiple frames in one chunk', () => {
    const { sock, messages } = makeStarted();
    sock.emit('data', Buffer.from(REQ(1) + '\n' + REQ(2) + '\n'));
    expect(messages).toHaveLength(2);
    expect((messages[1] as { id: number }).id).toBe(2);
  });

  it('reassembles a frame split across chunks', () => {
    const { sock, messages } = makeStarted();
    const full = REQ(7) + '\n';
    sock.emit('data', Buffer.from(full.slice(0, 5)));
    expect(messages).toHaveLength(0);
    sock.emit('data', Buffer.from(full.slice(5)));
    expect(messages).toHaveLength(1);
    expect((messages[0] as { id: number }).id).toBe(7);
  });

  it('reports a malformed frame without crashing and keeps parsing', () => {
    const { sock, messages, errors } = makeStarted();
    sock.emit('data', Buffer.from('not json\n' + REQ(3) + '\n'));
    expect(errors).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect((messages[0] as { id: number }).id).toBe(3);
  });

  it('rejects and destroys on an oversized frame (no newline)', () => {
    const { sock, errors } = makeStarted();
    sock.emit('data', Buffer.from('x'.repeat(100)));
    expect(errors[0].message).toMatch(/exceeds 64 bytes/);
    expect(sock.destroyed).toBeTruthy();
  });

  it('serialises outgoing messages with a trailing newline', async () => {
    const { sock, t } = makeStarted();
    await t.send({ jsonrpc: '2.0', id: 1, result: {} } as never);
    expect(sock.written[0]).toBe(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
  });

  it('rejects send after close', async () => {
    const { t } = makeStarted();
    await t.close();
    await expect(t.send({ jsonrpc: '2.0', id: 1, result: {} } as never)).rejects.toThrow(/closed/);
  });

  it('fires onclose once on socket close', () => {
    const { sock, t } = makeStarted();
    const onclose = vi.fn();
    t.onclose = onclose;
    sock.emit('close');
    sock.emit('close');
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
