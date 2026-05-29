import { StatusReport } from './statuspage';
import { SnapshotInfo } from './types';
import { TreeEntry } from './repo';
import { verifyTotp, signSession, verifySession } from './totp';
import { renderLoginPage, renderExplorerPage } from './browser-ui';
import { renderStatusHtml } from './statuspage';
import { classify } from './sensitive';

export interface RestoreResult {
  target: string;
  fileCount: number;
  bytes: number;
  durationMs: number;
}

export interface StagingDir {
  path: string;
  bytes: number;
  age: string;
}

/** everything the router needs, injected so handlers stay pure + testable. */
export interface ApiContext {
  now(): number;
  totpSecret: string;
  sessionSecret: string;
  sessionTtlMs: number;
  /** the deployment domain — the same-origin check accepts only this host. */
  domain: string;
  listApps(): string[];
  statusReport(): StatusReport;
  snapshots(app: string): SnapshotInfo[];
  lsTree(app: string, snap: string, path: string): TreeEntry[];
  fileMeta(app: string, snap: string, path: string): { size: number; sensitive: boolean } | null;
  restore(app: string, snap: string, path: string): RestoreResult;
  listStaging(): StagingDir[];
  deleteStaging(path: string): void;
}

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: unknown;
  cookies: Record<string, string>;
}

export type ApiResponse =
  | { kind: 'json'; status: number; body: unknown; setCookie?: string }
  | { kind: 'html'; status: number; body: string }
  | {
      kind: 'stream';
      status: number;
      app: string;
      snap: string;
      path: string;
      filename: string;
      contentType: string;
      disposition: 'inline' | 'attachment';
    }
  | { kind: 'redirect'; status: number; location: string };

const SESSION_COOKIE = 'fleet_backup_session';

function json(status: number, body: unknown, setCookie?: string): ApiResponse {
  return { kind: 'json', status, body, setCookie };
}

function hasSession(req: ApiRequest, ctx: ApiContext): boolean {
  const cookie = req.cookies[SESSION_COOKIE];
  if (!cookie) return false;
  return verifySession(cookie, ctx.sessionSecret, ctx.now()) !== null;
}

/** /api/* must carry the csrf header, and write methods must carry an
 *  Origin header whose host matches our domain exactly.
 *
 *  the custom `x-fleet-backup: 1` header is the primary barrier — modern
 *  browsers can't set it cross-origin without preflight, which a same-
 *  origin policy denies for any host that isn't our own. the Origin check
 *  is belt-and-braces, and matters specifically for POST / DELETE so the
 *  endsWith bug (where `evil-${domain}` would have been accepted) is
 *  closed and a missing Origin on a mutating request is rejected. read
 *  methods accept a missing Origin so health checks / curl probes keep
 *  working without the operator having to set an Origin manually. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfOk(req: ApiRequest, domain: string): boolean {
  if (req.headers['x-fleet-backup'] !== '1') return false;
  const origin = req.headers['origin'];
  const isWrite = !READ_METHODS.has(req.method.toUpperCase());
  if (!origin) return !isWrite;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === domain;
}

export function handle(req: ApiRequest, ctx: ApiContext): ApiResponse {
  // public: the login page
  if (req.path === '/login' && req.method === 'GET') {
    return { kind: 'html', status: 200, body: renderLoginPage() };
  }

  // /api/* — the CSRF + same-origin check runs before auth so a cross-site
  // probe is rejected (403) without ever reaching the session layer.
  if (req.path.startsWith('/api/')) {
    if (!csrfOk(req, ctx.domain)) return json(403, { error: 'csrf check failed' });

    if (req.path === '/api/login' && req.method === 'POST') {
      const code = (req.body as { code?: string } | undefined)?.code ?? '';
      if (!verifyTotp(ctx.totpSecret, code, ctx.now())) {
        return json(401, { error: 'invalid code' });
      }
      const cookie = signSession({ exp: ctx.now() + ctx.sessionTtlMs }, ctx.sessionSecret);
      const attrs = `Path=/backups; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(ctx.sessionTtlMs / 1000)}`;
      return json(200, { ok: true }, `${SESSION_COOKIE}=${cookie}; ${attrs}`);
    }

    if (!hasSession(req, ctx)) return json(401, { error: 'not authenticated' });
    return handleApi(req, ctx);
  }

  // every non-api route requires a session
  if (!hasSession(req, ctx)) {
    return { kind: 'redirect', status: 302, location: '/backups/login' };
  }
  if (req.path === '/' && req.method === 'GET') {
    return { kind: 'html', status: 200, body: renderStatusHtml(ctx.statusReport()) };
  }
  if (req.path === '/explore' && req.method === 'GET') {
    return { kind: 'html', status: 200, body: renderExplorerPage() };
  }

  return json(404, { error: 'not found' });
}

const SNAP_RE = /^[0-9a-f]{8,64}$/;
const INLINE_TYPES = ['text/', 'image/', 'application/pdf', 'application/json'];

function validPath(p: string): boolean {
  if (!p || !p.startsWith('/')) return false;
  // reject any traversal segment in the raw path — checking a normalised
  // path is useless here because normalisation collapses `..` away first.
  return !p.split('/').includes('..');
}

/** maps a restic error to 503 when the backend is unreachable, else 500. */
function resticErrorStatus(message: string): number {
  return /unreach|connection refused|dial |timeout|no route to host/i.test(message)
    ? 503
    : 500;
}

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    txt: 'text/plain', md: 'text/plain', log: 'text/plain', json: 'application/json',
    js: 'text/plain', ts: 'text/plain', css: 'text/plain', html: 'text/plain',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', pdf: 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}

function handleApi(req: ApiRequest, ctx: ApiContext): ApiResponse {
  const { path: route, query } = req;

  if (route === '/api/apps' && req.method === 'GET') {
    return json(200, ctx.statusReport());
  }

  if (route === '/api/snapshots' && req.method === 'GET') {
    const app = query.app ?? '';
    if (!ctx.listApps().includes(app)) return json(404, { error: 'unknown app' });
    return json(200, { snapshots: ctx.snapshots(app) });
  }

  if (route === '/api/ls' && req.method === 'GET') {
    const { app = '', snap = '', path = '/' } = query;
    if (!ctx.listApps().includes(app)) return json(404, { error: 'unknown app' });
    if (!SNAP_RE.test(snap)) return json(400, { error: 'bad snapshot id' });
    if (!validPath(path)) return json(400, { error: 'bad path' });
    try {
      // sensitivity is derived from the path itself — no per-entry restic call.
      const entries = ctx.lsTree(app, snap, path).map(e => ({
        ...e,
        sensitive: classify(e.path) === 'sensitive',
      }));
      return json(200, { path, entries });
    } catch (e) {
      const msg = (e as Error).message;
      return json(resticErrorStatus(msg), { error: msg });
    }
  }

  if (route === '/api/staging' && req.method === 'GET') {
    return json(200, { staging: ctx.listStaging() });
  }

  if (route === '/api/restore' && req.method === 'POST') {
    const b = (req.body ?? {}) as { app?: string; snap?: string; path?: string };
    const app = b.app ?? '';
    const snap = b.snap ?? '';
    const path = b.path ?? '';
    if (!ctx.listApps().includes(app)) return json(404, { error: 'unknown app' });
    if (!SNAP_RE.test(snap)) return json(400, { error: 'bad snapshot id' });
    if (!validPath(path)) return json(400, { error: 'bad path' });
    try {
      return json(200, ctx.restore(app, snap, path));
    } catch (e) {
      const msg = (e as Error).message;
      // doRestore throws a code-507 error when staging space is short
      const status = (e as { code?: number }).code === 507 ? 507 : 500;
      return json(status, { error: msg });
    }
  }

  if (route === '/api/staging' && req.method === 'DELETE') {
    const p = query.path ?? '';
    if (!p.startsWith('/var/restore/') || p.includes('..')) {
      return json(400, { error: 'bad staging path' });
    }
    try {
      ctx.deleteStaging(p);
      return json(200, { ok: true });
    } catch (e) {
      return json(500, { error: (e as Error).message });
    }
  }

  if (route === '/api/file' && req.method === 'GET') {
    const { app = '', snap = '', path = '', dl } = query;
    if (!ctx.listApps().includes(app)) return json(404, { error: 'unknown app' });
    if (!SNAP_RE.test(snap)) return json(400, { error: 'bad snapshot id' });
    if (!validPath(path)) return json(400, { error: 'bad path' });
    const meta = ctx.fileMeta(app, snap, path);
    if (!meta) return json(404, { error: 'file not found' });
    if (meta.sensitive) return json(403, { error: 'sensitive path — view/download blocked' });
    const filename = path.slice(path.lastIndexOf('/') + 1);
    const ct = contentTypeFor(path);
    const inlineable = INLINE_TYPES.some(t => ct.startsWith(t)) && meta.size <= 5 * 1024 * 1024;
    return {
      kind: 'stream',
      status: 200,
      app, snap, path, filename,
      contentType: ct,
      disposition: dl === '1' || !inlineable ? 'attachment' : 'inline',
    };
  }

  return json(404, { error: 'not found' });
}
