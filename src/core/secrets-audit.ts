/**
 * Append-only audit log of every sensitive secret operation.
 *
 * Stored at ~/.local/share/fleet/audit.jsonl with mode 0600. Each line is a
 * JSON object — never the secret VALUE, only its name. Flushed synchronously
 * so a crash mid-rotation still leaves a trail.
 */

import { existsSync, mkdirSync, appendFileSync, chmodSync, statSync, openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

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
  app?: string;
  secret?: string;
  ok: boolean;
  details?: string;
}

const AUDIT_DIR = join(homedir(), '.local', 'share', 'fleet');
const AUDIT_PATH = join(AUDIT_DIR, 'audit.jsonl');

function getActor(): string {
  return process.env.SUDO_USER || process.env.USER || process.env.LOGNAME || 'unknown';
}

function ensureLog(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(AUDIT_PATH)) {
    // Atomic create with the desired mode in a single syscall — closes the
    // TOCTOU window where the file briefly existed at the umask default
    // (typically 0o644) before the chmod.
    const fd = openSync(AUDIT_PATH, 'a', 0o600);
    closeSync(fd);
    return;
  }
  try {
    const mode = statSync(AUDIT_PATH).mode & 0o777;
    if (mode !== 0o600) chmodSync(AUDIT_PATH, 0o600);
  } catch {
    /* ignore */
  }
}

export function auditLog(entry: Omit<AuditEntry, 'ts' | 'actor'> & { actor?: string }): void {
  ensureLog();
  const line: AuditEntry = {
    ts: new Date().toISOString(),
    actor: entry.actor ?? getActor(),
    op: entry.op,
    app: entry.app,
    secret: entry.secret,
    ok: entry.ok,
    details: entry.details,
  };
  appendFileSync(AUDIT_PATH, JSON.stringify(line) + '\n');
}

export function getAuditPath(): string {
  return AUDIT_PATH;
}
