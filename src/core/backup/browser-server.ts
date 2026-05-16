import {
  existsSync, mkdirSync, statfsSync, readdirSync, statSync, rmSync, appendFileSync,
} from 'node:fs';
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';

import { handle, ApiContext, ApiRequest, ApiResponse } from './browser-api';
import { listConfiguredApps } from './config';
import { listSnapshots, lsTree, dumpFileSpawn, restore } from './repo';
import { classify } from './sensitive';
import { buildStatusReport } from './status';

const MAX_INFLIGHT = 4;
let inFlight = 0;
const AUDIT_LOG = '/var/log/fleet-backup/audit.log';

/** appends a structured audit line to journald (via stdout) and a log file. */
function audit(action: string, detail: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), action, ...detail });
  // stdout is captured by journald when run as a systemd unit
  process.stdout.write(`[audit] ${line}\n`);
  try {
    appendFileSync(AUDIT_LOG, line + '\n');
  } catch {
    /* best effort — never fail a request because the audit file is unwritable */
  }
}

/** recursive byte size of a directory tree. */
function dirSize(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    const st = statSync(full);
    total += st.isDirectory() ? dirSize(full) : st.size;
  }
  return total;
}

function humanAge(mtimeMs: number): string {
  const h = Math.floor((Date.now() - mtimeMs) / 3600_000);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export interface ServeOptions {
  port: number;
  totpSecret: string;
  sessionSecret: string;
  sessionTtlMs?: number;
  stagingRoot?: string;
}

const STAGING_ROOT_DEFAULT = '/var/restore';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size <= 1_000_000) chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) { resolve(undefined); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve(undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}

/** restores a single path into a fresh timestamped staging dir. */
function doRestore(app: string, snap: string, path: string, stagingRoot: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const target = `${stagingRoot}/${app}-${snap.slice(0, 8)}-${ts}`;
  // pre-flight: refuse if the filesystem is nearly full
  const fs = statfsSync(stagingRoot);
  if (fs.bavail * fs.bsize < 64 * 1024 * 1024) {
    const e = new Error('insufficient staging space') as Error & { code: number };
    e.code = 507;
    throw e;
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const started = Date.now();
  restore(app, { snapshotId: snap, target, include: [path] });
  return { target, fileCount: 1, bytes: 0, durationMs: Date.now() - started };
}

function buildContext(opts: ServeOptions): ApiContext {
  const stagingRoot = opts.stagingRoot ?? STAGING_ROOT_DEFAULT;
  return {
    now: () => Date.now(),
    totpSecret: opts.totpSecret,
    sessionSecret: opts.sessionSecret,
    sessionTtlMs: opts.sessionTtlMs ?? 12 * 3600_000,
    listApps: () => listConfiguredApps(),
    statusReport: () => buildStatusReport(),
    snapshots: app => listSnapshots(app),
    lsTree: (app, snap, path) => lsTree(app, snap, path),
    fileMeta: (app, snap, path) => {
      // size comes from the parent dir listing; sensitivity from the classifier.
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      const entry = lsTree(app, snap, parent).find(e => e.path === path);
      if (!entry) return null;
      return { size: entry.size, sensitive: classify(path) === 'sensitive' };
    },
    restore: (app, snap, path) => doRestore(app, snap, path, stagingRoot),
    listStaging: () => {
      if (!existsSync(stagingRoot)) return [];
      return readdirSync(stagingRoot)
        .map(name => `${stagingRoot}/${name}`)
        .filter(p => statSync(p).isDirectory())
        .map(p => ({ path: p, bytes: dirSize(p), age: humanAge(statSync(p).mtimeMs) }));
    },
    deleteStaging: (path: string) => {
      if (!path.startsWith(stagingRoot + '/')) {
        throw new Error('refusing to delete outside the staging root');
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}

function sendResponse(httpRes: ServerResponse, apiRes: ApiResponse): void {
  if (apiRes.kind === 'json') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiRes.setCookie) headers['Set-Cookie'] = apiRes.setCookie;
    httpRes.writeHead(apiRes.status, headers);
    httpRes.end(JSON.stringify(apiRes.body));
    return;
  }
  if (apiRes.kind === 'html') {
    httpRes.writeHead(apiRes.status, { 'Content-Type': 'text/html; charset=utf-8' });
    httpRes.end(apiRes.body);
    return;
  }
  if (apiRes.kind === 'redirect') {
    httpRes.writeHead(apiRes.status, { Location: apiRes.location });
    httpRes.end();
    return;
  }
  // stream: pipe `restic dump` straight to the response
  const child = dumpFileSpawn(apiRes.app, apiRes.snap, apiRes.path);
  httpRes.writeHead(apiRes.status, {
    'Content-Type': apiRes.contentType,
    'Content-Disposition': `${apiRes.disposition}; filename="${apiRes.filename.replace(/"/g, '')}"`,
  });
  child.stdout.pipe(httpRes);
  child.stderr.on('data', () => { /* swallowed; non-zero close handled below */ });
  child.on('error', () => { if (!httpRes.headersSent) httpRes.writeHead(500); httpRes.end(); });
  child.on('close', code => { if (code !== 0) httpRes.end(); });
}

/** starts the explorer http service, resolving once it is bound. the socket
 *  is localhost-only (nginx fronts it). */
export function startServer(opts: ServeOptions): Promise<Server> {
  const ctx = buildContext(opts);
  const stagingRoot = opts.stagingRoot ?? STAGING_ROOT_DEFAULT;
  if (!existsSync(stagingRoot)) mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

  const server = createServer(async (httpReq, httpRes) => {
    try {
      const url = new URL(httpReq.url ?? '/', 'http://localhost');

      // soft concurrency cap on the heavy routes (streaming a file, running a
      // restore) — refuse rather than fork unbounded restic processes.
      const heavy = url.pathname === '/api/file' || url.pathname === '/api/restore';
      if (heavy) {
        if (inFlight >= MAX_INFLIGHT) {
          httpRes.writeHead(429, { 'Content-Type': 'application/json' });
          httpRes.end(JSON.stringify({ error: 'too many concurrent operations' }));
          return;
        }
        inFlight++;
        httpRes.on('close', () => { inFlight--; });
      }

      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => { query[k] = v; });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(httpReq.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
      }
      const apiReq: ApiRequest = {
        method: httpReq.method ?? 'GET',
        path: url.pathname,
        query,
        headers,
        cookies: parseCookies(httpReq.headers['cookie']),
        body: httpReq.method === 'POST' ? await readBody(httpReq) : undefined,
      };
      const apiRes = handle(apiReq, ctx);

      // audit the security-relevant actions (view/download, restore, delete).
      if (apiRes.status < 400) {
        if (url.pathname === '/api/file') {
          audit('view', { app: query.app, snap: query.snap, path: query.path, dl: query.dl === '1' });
        } else if (url.pathname === '/api/restore') {
          const b = (apiReq.body ?? {}) as Record<string, unknown>;
          audit('restore', { app: b.app, snap: b.snap, path: b.path });
        } else if (url.pathname === '/api/staging' && apiReq.method === 'DELETE') {
          audit('staging-delete', { path: query.path });
        }
      }

      sendResponse(httpRes, apiRes);
    } catch (e) {
      if (!httpRes.headersSent) httpRes.writeHead(500, { 'Content-Type': 'application/json' });
      httpRes.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve(server));
  });
}
