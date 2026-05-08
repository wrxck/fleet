import { createServer as netCreateServer } from 'node:net';
import type { Socket } from 'node:net';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';

import { execSafe } from './exec.js';
import { SecretsError } from './errors.js';
import { parseRequest, writeResponse, ProtocolError } from './secrets-v2-protocol.js';

export const IDLE_TIMEOUT_MS = 30_000;

const TERM = Buffer.from('\r\n\r\n');

// module-level token bucket — limits total throughput to 100 req/sec across all connections
let _tokens = 100;
let _lastRefill = Date.now();

function takeToken(): boolean {
  const now = Date.now();
  const elapsed = (now - _lastRefill) / 1000;
  if (elapsed > 0) {
    _tokens = Math.min(100, _tokens + elapsed * 100);
    _lastRefill = now;
  }
  if (_tokens < 1) return false;
  _tokens -= 1;
  return true;
}

export function _resetRateLimit(initialTokens = 100): void {
  _tokens = initialTokens;
  _lastRefill = Date.now();
}

export function decryptVaultBlob(privateKeyPath: string, blobPath: string): Record<string, string> {
  if (!existsSync(blobPath)) throw new SecretsError(`vault blob not found: ${blobPath}`);
  if (!existsSync(privateKeyPath)) throw new SecretsError(`private key not found: ${privateKeyPath}`);
  const r = execSafe('age', ['-d', '-i', privateKeyPath, blobPath]);
  if (!r.ok) throw new SecretsError(`age decrypt failed: ${r.stderr}`);
  return parseEnvFormat(r.stdout);
}

/**
 * Parse plaintext env content into a key/value map.
 *
 * Note: callers receive `content` after `execSafe` has applied `.trim()` to
 * the full stdout. Leading/trailing whitespace at the start of the first
 * line and end of the last line is consumed before parsing. Secret values
 * with deliberate edge whitespace will be subtly altered. This is a known
 * project-wide gotcha (also affects v1 secrets); see brain note q5YkhSmRVx9m.
 */
function parseEnvFormat(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim() || rawLine.startsWith('#')) continue;
    const i = rawLine.indexOf('=');
    if (i > 0) {
      map[rawLine.slice(0, i)] = rawLine.slice(i + 1);
    }
  }
  return map;
}

const MAX_REQUEST_BYTES = 8192;

export interface AgentDeps {
  app: string;
  getSecrets: () => Record<string, string>;
  refresh: () => void;
}

export interface Server {
  listen(path: string): Promise<void>;
  close(): Promise<void>;
}

export function createServer(deps: AgentDeps): Server {
  const server = netCreateServer((sock) => handleConnection(sock, deps));
  let socketPath = '';

  return {
    listen: (path) => new Promise<void>((resolve, reject) => {
      socketPath = path;
      if (existsSync(path)) {
        try { unlinkSync(path); } catch { /* race; let listen fail naturally */ }
      }
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(path, () => {
        server.off('error', onError);
        try { chmodSync(path, 0o660); } catch { /* non-fatal; listen succeeded */ }
        resolve();
      });
    }),
    close: () => new Promise<void>((resolve) => {
      server.close(() => {
        if (socketPath && existsSync(socketPath)) {
          try { unlinkSync(socketPath); } catch { /* ignore */ }
        }
        resolve();
      });
    }),
  };
}

function handleConnection(sock: Socket, deps: AgentDeps): void {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let handled = false;
  let searchedUpTo = 0;

  sock.setTimeout(IDLE_TIMEOUT_MS, () => sock.destroy());

  const handle = () => {
    if (handled) return;
    handled = true;
    if (!takeToken()) {
      sock.end(writeResponse(429, { error: 'rate_limited' }));
      return;
    }
    const buf = Buffer.concat(chunks);
    try {
      const req = parseRequest(buf);
      const resp = dispatch(req, deps);
      sock.end(resp);
    } catch (err) {
      const isProto = err instanceof ProtocolError;
      const status = isProto ? 400 : 500;
      const message = isProto ? (err as Error).message : 'internal';
      sock.end(writeResponse(status, { error: message }));
    }
  };

  sock.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      handled = true;
      sock.end(writeResponse(413, { error: 'request too large' }));
      return;
    }
    const buf = Buffer.concat(chunks);
    const idx = buf.indexOf(TERM, Math.max(0, searchedUpTo - 3));
    if (idx >= 0) {
      handle();
    } else {
      searchedUpTo = buf.length;
    }
  });
  sock.on('end', () => { if (!handled) handle(); });
  sock.on('error', () => { /* connection-level errors are fatal for that connection only */ });
}

function dispatch(req: { method: string; path: string }, deps: AgentDeps): Buffer {
  if (req.method === 'GET' && req.path === '/health') {
    const m = deps.getSecrets();
    return writeResponse(200, { app: deps.app, secrets: Object.keys(m).length });
  }
  if (req.method === 'POST' && req.path === '/refresh') {
    deps.refresh();
    return writeResponse(200, { reloaded: true });
  }
  if (req.method === 'GET' && req.path === '/secrets') {
    return writeResponse(200, deps.getSecrets());
  }
  if (req.method === 'GET' && req.path.startsWith('/secrets/')) {
    const key = req.path.slice('/secrets/'.length);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return writeResponse(400, { error: 'invalid_key' });
    }
    const m = deps.getSecrets();
    if (key in m) return writeResponse(200, { value: m[key] });
    return writeResponse(404, { error: 'not_found' });
  }
  return writeResponse(404, { error: 'not_found' });
}
