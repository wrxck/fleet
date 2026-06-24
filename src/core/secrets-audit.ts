/**
 * Append-only audit log of every sensitive secret operation.
 *
 * Stored under a fixed, root-owned directory (FLEET_AUDIT_DIR, default
 * /var/log/fleet) at mode 0600 — not the invoking user's home — so the trail
 * does not fragment across users and a non-root user cannot rewrite their own
 * history. Each line is a JSON object — never the secret VALUE, only its name —
 * and carries a trusted `uid` (the real login/process uid) alongside the
 * human-readable, environment-derived `actor`. Flushed synchronously so a crash
 * mid-rotation still leaves a trail.
 */

import { existsSync, mkdirSync, appendFileSync, chmodSync, statSync, openSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type AuditOp =
  | 'init'
  | 'seal'
  | 'unseal'
  | 'set'
  | 'get'
  | 'rotate'
  | 'rotate-attempted'
  | 'rotate-failed'
  | 'rollback'
  | 'snapshot'
  | 'harden'
  | 'export'
  | 'import';

export interface AuditEntry {
  ts: string;
  op: AuditOp;
  actor: string;
  uid?: number;
  app?: string;
  secret?: string;
  ok: boolean;
  details?: string;
}

// resolved at call time so FLEET_AUDIT_DIR can be set per-process (and by tests).
function auditDir(): string {
  return process.env.FLEET_AUDIT_DIR ?? '/var/log/fleet';
}

function auditPath(): string {
  return join(auditDir(), 'secrets-audit.jsonl');
}

function getActor(): string {
  return process.env.SUDO_USER || process.env.USER || process.env.LOGNAME || 'unknown';
}

// the real, non-spoofable uid: the audit `actor` is derived from environment
// variables a caller controls, so we pair it with the kernel-reported login uid
// (surviving su/sudo) or, failing that, the process uid.
function trustedUid(): number | undefined {
  try {
    const raw = readFileSync('/proc/self/loginuid', 'utf-8').trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n !== 0xffffffff) return n;
  } catch {
    /* not linux / loginuid unavailable */
  }
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function ensureLog(): void {
  const dir = auditDir();
  const path = auditPath();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(path)) {
    // atomic create with the desired mode in a single syscall — closes the
    // toctou window where the file briefly existed at the umask default
    // (typically 0o644) before the chmod.
    const fd = openSync(path, 'a', 0o600);
    closeSync(fd);
    return;
  }
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function auditLog(entry: Omit<AuditEntry, 'ts' | 'actor' | 'uid'> & { actor?: string }): void {
  // auditing must never block the actual operation. if the fs isn't writable
  // (read-only mount, missing dir, mocked-out tests, etc.), surface a single
  // stderr warning and continue. the op succeeds; we just lose this audit line.
  try {
    ensureLog();
    const line: AuditEntry = {
      ts: new Date().toISOString(),
      actor: entry.actor ?? getActor(),
      uid: trustedUid(),
      op: entry.op,
      app: entry.app,
      secret: entry.secret,
      ok: entry.ok,
      details: entry.details,
    };
    appendFileSync(auditPath(), JSON.stringify(line) + '\n');
  } catch (err) {
    process.stderr.write(
      `[fleet audit] WARNING: failed to write audit entry (${err instanceof Error ? err.message : err})\n`,
    );
  }
}

export function getAuditPath(): string {
  return auditPath();
}
