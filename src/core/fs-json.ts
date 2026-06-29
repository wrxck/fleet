import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// atomic, crash-durable json write: serialise to a sibling temp file, fsync it,
// then rename over the target. a crash can never leave a torn file, and a
// concurrent reader sees either the old or the new file, never a partial one.
// the temp file carries a unique (pid + random) suffix so two processes writing
// the same target never clobber each other's partial write, and a failed write
// is cleaned up rather than left behind. mode defaults to 0600 and is enforced
// with fchmod (not just the open() create-mode) so a pre-existing temp file or a
// permissive umask cannot widen the result. the parent directory is created if
// missing.
export function writeJsonAtomic(path: string, data: unknown, opts: { mode?: number } = {}): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const mode = opts.mode ?? 0o600;
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const json = JSON.stringify(data, null, 2) + '\n';
  const fd = openSync(tmp, 'w', mode);
  let closed = false;
  try {
    fchmodSync(fd, mode);
    writeFileSync(fd, json); // loops internally; no short-write risk
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    renameSync(tmp, path);
  } catch (err) {
    if (!closed) {
      try { closeSync(fd); } catch { /* fd already closed */ }
    }
    try { unlinkSync(tmp); } catch { /* best effort: never leave a stale temp file */ }
    throw err;
  }
}

// read and parse a json file, returning null when the file is missing or
// unparseable. callers that must distinguish "absent" from "corrupt" should
// read/parse directly.
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}
