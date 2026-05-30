import type { Socket } from 'node:net';

import { serializeMessage, deserializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// default cap on a single newline-delimited json-rpc frame. a well-behaved
// client never approaches this; a hostile or buggy peer that streams bytes
// without a newline is cut off rather than allowed to exhaust memory.
const DEFAULT_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

// mcp transport that speaks the same newline-delimited json-rpc framing as the
// stdio transport, but over a connected unix-domain socket. one instance wraps
// one accepted connection; the daemon creates a fresh server + transport per
// connection so sessions never share state.
export class SocketServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private buf = Buffer.alloc(0);
  private started = false;
  private closed = false;
  private readonly maxMessageBytes: number;

  constructor(private readonly socket: Socket, opts: { maxMessageBytes?: number } = {}) {
    this.maxMessageBytes = opts.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('SocketServerTransport already started');
    this.started = true;
    this.socket.on('data', this.onData);
    this.socket.on('error', this.onSocketError);
    this.socket.on('close', this.onSocketClose);
  }

  private onData = (chunk: Buffer): void => {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    this.drainBuffer();
  };

  private drainBuffer(): void {
    for (;;) {
      const nl = this.buf.indexOf(0x0a); // '\n'
      if (nl === -1) {
        // no complete frame yet — guard against unbounded growth.
        if (this.buf.length > this.maxMessageBytes) {
          this.fail(new Error(`message exceeds ${this.maxMessageBytes} bytes without a newline`));
        }
        return;
      }
      if (nl > this.maxMessageBytes) {
        this.fail(new Error(`message exceeds ${this.maxMessageBytes} bytes`));
        return;
      }
      const line = this.buf.subarray(0, nl).toString('utf8');
      this.buf = this.buf.subarray(nl + 1);
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const message = deserializeMessage(trimmed);
        this.onmessage?.(message);
      } catch (err) {
        // a malformed frame is reported but does not tear down the connection;
        // the next valid frame still parses.
        this.onerror?.(err as Error);
      }
    }
  }

  private onSocketError = (err: Error): void => {
    this.onerror?.(err);
  };

  private onSocketClose = (): void => {
    this.handleClose();
  };

  // surface a fatal framing error and drop the connection.
  private fail(err: Error): void {
    this.onerror?.(err);
    this.socket.destroy();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed || this.socket.destroyed) {
        reject(new Error('socket is closed'));
        return;
      }
      const json = serializeMessage(message);
      this.socket.write(json, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onSocketError);
    this.socket.off('close', this.onSocketClose);
    if (!this.socket.destroyed) this.socket.end();
    this.handleClose();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.buf = Buffer.alloc(0);
    this.onclose?.();
  }
}
