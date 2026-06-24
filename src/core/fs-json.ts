import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

// atomic, crash-durable json write: serialise to a sibling temp file, fsync it,
// then rename over the target. a crash can never leave a torn file, and a
// concurrent reader sees either the old or the new file, never a partial one.
// the parent directory is created if missing. mode defaults to 0600.
export function writeJsonAtomic(path: string, data: unknown, opts: { mode?: number } = {}): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  const json = JSON.stringify(data, null, 2) + '\n';
  const fd = openSync(tmp, 'w', opts.mode ?? 0o600);
  try {
    writeSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
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
