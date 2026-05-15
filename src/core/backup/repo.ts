import { FleetError } from '../errors';
import { execSafe } from '../exec';

import { Retention, SnapshotInfo, RepoStats } from './types';
import { passwordCommandFor } from './unlock';

export const SFTP_HOST_ALIAS = process.env.FLEET_BACKUP_SFTP_ALIAS ?? 'backup-vps-sftp';

export class ResticError extends FleetError {}

/** when fleet_backup_base_url is set we use it as the backend base — that
 *  enables rest:// + append-only protection. when unset we fall back to the
 *  legacy sftp alias. the systemd unit loads the url + rest creds from
 *  encrypted credstore so they never sit on disk in plaintext. */
function repoUri(app: string): string {
  const base = process.env.FLEET_BACKUP_BASE_URL;
  if (base) {
    return base.endsWith('/') ? `${base}${app}` : `${base}/${app}`;
  }
  return `sftp:${SFTP_HOST_ALIAS}:${app}`;
}

/** true when the backend rejects deletions/rewrites (rest-server --append-only
 *  in particular). primary-side prune must skip on such backends — pruning
 *  happens locally on the backup vps via its own cron. */
export function isAppendOnly(): boolean {
  return (process.env.FLEET_BACKUP_BASE_URL ?? '').startsWith('rest:');
}

function resticEnv(app: string): Record<string, string> {
  // restic respects restic_rest_username/password env vars; the wrapper
  // populates them from the encrypted credstore.
  const env: Record<string, string> = { RESTIC_PASSWORD_COMMAND: passwordCommandFor(app) };
  if (process.env.RESTIC_REST_USERNAME) env.RESTIC_REST_USERNAME = process.env.RESTIC_REST_USERNAME;
  if (process.env.RESTIC_REST_PASSWORD) env.RESTIC_REST_PASSWORD = process.env.RESTIC_REST_PASSWORD;
  return env;
}

function runRestic(app: string, args: string[], timeoutMs = 60_000): { stdout: string; stderr: string; ok: boolean } {
  const r = execSafe('restic', ['-r', repoUri(app), ...args], {
    timeout: timeoutMs,
    env: resticEnv(app),
  });
  return { stdout: r.stdout, stderr: r.stderr, ok: r.ok };
}

export function initRepo(app: string): void {
  // if it already exists, snapshots --no-lock succeeds; only init when it doesn't.
  const probe = runRestic(app, ['snapshots', '--no-lock', '--quiet'], 15_000);
  if (probe.ok) return;
  const init = runRestic(app, ['init'], 30_000);
  if (!init.ok) throw new ResticError(`restic init failed: ${init.stderr}`);
}

export interface BackupOptions {
  paths: string[];
  excludes?: string[];
  tags?: string[];
  /** add a host=... override (useful for restoring tests). */
  hostname?: string;
  /** when set, restic gets --stdin --stdin-filename and paths are ignored
   *  (restic does not accept both). */
  stdinFilename?: string;
  /** small in-memory payloads piped via process stdin (~1mb safe). */
  stdinData?: string;
  /** for large/streaming payloads: a shell command whose stdout is piped
   *  into `restic backup --stdin` via `sh -c "<cmd> | restic ..."`. avoids
   *  the spawnSync 1mb buffer ceiling so multi-gb dumps work. */
  stdinCommand?: string;
  /** dry-run: restic walks paths and reports what would be added, no upload. */
  dryRun?: boolean;
}

/** sh single-quote escape — wraps s in '...' with embedded quotes as '\''. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function snapshot(app: string, opts: BackupOptions, timeoutMs = 30 * 60_000): SnapshotInfo {
  const args = ['backup'];
  if (opts.dryRun) args.push('--dry-run');
  for (const ex of opts.excludes ?? []) {
    args.push('--exclude', ex);
  }
  for (const tag of opts.tags ?? []) {
    args.push('--tag', tag);
  }
  if (opts.hostname) {
    args.push('--host', opts.hostname);
  }
  if (opts.stdinFilename) {
    // restic --stdin reads from stdin only; positional paths must be omitted.
    args.push('--stdin', '--stdin-filename', opts.stdinFilename);
  } else {
    args.push(...opts.paths);
  }
  args.push('--json');

  let r;
  if (opts.stdinCommand) {
    // stream via bash — kernel pipes between the dump cmd and restic, so
    // the dump bytes never enter node's spawnSync buffer. bash is used
    // explicitly (rather than /bin/sh which is dash on ubuntu) because
    // we need `pipefail` to surface dump errors that would otherwise be
    // masked by restic's exit code.
    const resticInvocation = ['restic', '-r', repoUri(app), ...args]
      .map(shellQuote)
      .join(' ');
    const fullCmd = `set -eo pipefail; ${opts.stdinCommand} | ${resticInvocation}`;
    if (process.env.FLEET_DEBUG_DUMP === '1') {
      process.stderr.write(`[fleet-debug] bash -c: ${fullCmd}\n`);
    }
    r = execSafe('bash', ['-c', fullCmd], {
      timeout: timeoutMs,
      env: resticEnv(app),
    });
  } else {
    r = execSafe('restic', ['-r', repoUri(app), ...args], {
      timeout: timeoutMs,
      env: resticEnv(app),
      input: opts.stdinData,
    });
  }
  if (!r.ok) throw new ResticError(`restic backup failed: ${r.stderr || r.stdout}`);

  // last json line is the summary with snapshot_id (or counters for dry-run)
  const lines = r.stdout.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.message_type === 'summary') {
        return {
          id: obj.snapshot_id ?? 'dry-run',
          shortId: (obj.snapshot_id ?? 'dry-run').slice(0, 8),
          time: new Date().toISOString(),
          hostname: opts.hostname ?? '',
          paths: opts.paths,
          tags: opts.tags ?? [],
          sizeBytes: obj.data_added,
        };
      }
    } catch { /* not json, skip */ }
  }
  throw new ResticError(`could not parse restic snapshot summary`);
}

export function listSnapshots(app: string): SnapshotInfo[] {
  const r = runRestic(app, ['snapshots', '--json'], 15_000);
  if (!r.ok) {
    if (r.stderr.includes('does not exist')) return [];
    throw new ResticError(`restic snapshots failed: ${r.stderr}`);
  }
  if (!r.stdout) return [];
  const arr = JSON.parse(r.stdout) as Array<{ id: string; short_id: string; time: string; hostname: string; paths: string[]; tags?: string[] }>;
  return arr.map(s => ({
    id: s.id,
    shortId: s.short_id,
    time: s.time,
    hostname: s.hostname,
    paths: s.paths,
    tags: s.tags ?? [],
  }));
}

export interface RestoreOptions {
  snapshotId: string;
  target: string;
  /** restore only these subpaths (restic --include). */
  include?: string[];
  /** dry-run: list files that would be restored without writing. */
  dryRun?: boolean;
  /** post-restore integrity check: re-walks the restored tree and confirms
   *  file contents match the snapshot's chunk hashes (restic --verify). */
  verify?: boolean;
}

export function restore(app: string, opts: RestoreOptions, timeoutMs = 60 * 60_000): void {
  const args = ['restore', opts.snapshotId, '--target', opts.target];
  if (opts.dryRun) args.push('--dry-run');
  if (opts.verify) args.push('--verify');
  for (const inc of opts.include ?? []) {
    args.push('--include', inc);
  }
  const r = runRestic(app, args, timeoutMs);
  if (!r.ok) throw new ResticError(`restic restore failed: ${r.stderr}`);
}

/** orthogonal integrity check: walks the restic repo, recomputes chunk
 *  hashes, asserts the index is consistent. catches bit-rot on the
 *  backup-vps disk. callable independently or right after a restore. */
export function checkIntegrity(app: string, readDataPercent = 5): { ok: boolean; output: string } {
  const r = runRestic(app, ['check', `--read-data-subset=${readDataPercent}%`], 30 * 60_000);
  return { ok: r.ok, output: r.ok ? r.stdout : `${r.stdout}\n${r.stderr}`.trim() };
}

export function prune(app: string, retention: Retention): void {
  const args = ['forget', '--prune'];
  if (retention.hourly) args.push('--keep-hourly', String(retention.hourly));
  if (retention.daily) args.push('--keep-daily', String(retention.daily));
  if (retention.weekly) args.push('--keep-weekly', String(retention.weekly));
  if (retention.monthly) args.push('--keep-monthly', String(retention.monthly));
  if (retention.yearly) args.push('--keep-yearly', String(retention.yearly));
  if (args.length === 2) {
    throw new ResticError('retention is empty — refusing to forget all snapshots');
  }
  const r = runRestic(app, args, 5 * 60_000);
  if (!r.ok) throw new ResticError(`restic forget failed: ${r.stderr}`);
}

export function check(app: string): boolean {
  const r = runRestic(app, ['check', '--read-data-subset=5%'], 10 * 60_000);
  return r.ok;
}

export function stats(app: string): RepoStats | null {
  const r = runRestic(app, ['stats', 'latest', '--json'], 15_000);
  if (!r.ok || !r.stdout) return null;
  try {
    const obj = JSON.parse(r.stdout);
    return {
      totalSize: obj.total_size ?? 0,
      totalFileCount: obj.total_file_count ?? 0,
      snapshotCount: obj.snapshots_count ?? 0,
    };
  } catch {
    return null;
  }
}
