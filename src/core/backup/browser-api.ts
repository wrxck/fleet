import { StatusReport } from './statuspage';
import { SnapshotInfo } from './types';
import { TreeEntry } from './repo';
import { verifyTotp, signSession, verifySession } from './totp';
import { renderLoginPage, renderExplorerPage } from './browser-ui';
import { renderStatusHtml } from './statuspage';

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

/** /api/* must carry the csrf header and, if an origin is present, a same-origin one. */
function csrfOk(req: ApiRequest): boolean {
  if (req.headers['x-fleet-backup'] !== '1') return false;
  const origin = req.headers['origin'];
  if (origin && !origin.endsWith('fleet.hesketh.pro')) return false;
  return true;
}

export function handle(req: ApiRequest, ctx: ApiContext): ApiResponse {
  // public: the login page
  if (req.path === '/login' && req.method === 'GET') {
    return { kind: 'html', status: 200, body: renderLoginPage() };
  }

  // /api/* — the CSRF + same-origin check runs before auth so a cross-site
  // probe is rejected (403) without ever reaching the session layer.
  if (req.path.startsWith('/api/')) {
    if (!csrfOk(req)) return json(403, { error: 'csrf check failed' });

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

// handleApi is implemented in task 8.
function handleApi(req: ApiRequest, ctx: ApiContext): ApiResponse {
  void req;
  void ctx;
  return json(404, { error: 'not found' });
}
