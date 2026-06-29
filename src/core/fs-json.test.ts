import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readJson, writeJsonAtomic } from './fs-json';

describe('writeJsonAtomic / readJson', () => {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

  function tmp(): string {
    // os tmpdir is noexec on some hosts but writable; home is always fine.
    const d = mkdtempSync(join(homedir(), '.fleet-fsjson-'));
    made.push(d);
    return d;
  }

  it('round-trips data and creates the parent directory', () => {
    const path = join(tmp(), 'nested', 'state.json');
    writeJsonAtomic(path, { a: 1, b: ['x'] });
    expect(readJson<{ a: number; b: string[] }>(path)).toEqual({ a: 1, b: ['x'] });
  });

  it('applies the requested mode', () => {
    const path = join(tmp(), 'state.json');
    writeJsonAtomic(path, {}, { mode: 0o600 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp sibling behind on success', () => {
    const dir = tmp();
    const path = join(dir, 'state.json');
    writeJsonAtomic(path, { ok: true });
    // unique-suffixed temp file must be renamed away, not just the legacy `.tmp`.
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('enforces 0600 even when the requested mode is omitted', () => {
    const path = join(tmp(), 'state.json');
    writeJsonAtomic(path, {});
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('preserves the existing target and cleans up the temp file when the rename fails', () => {
    const dir = tmp();
    // make the target an existing non-empty directory so renameSync() fails.
    const path = join(dir, 'target');
    mkdirSync(join(path, 'child'), { recursive: true });
    expect(() => writeJsonAtomic(path, { v: 1 })).toThrow();
    // the failed write must not litter a temp file next to the target.
    expect(readdirSync(dir).filter(f => f.includes('.tmp'))).toEqual([]);
    // the pre-existing target is untouched.
    expect(statSync(path).isDirectory()).toBe(true);
  });

  it('serialises repeated writes to the same target without leaving temp files', () => {
    const dir = tmp();
    const path = join(dir, 'state.json');
    for (let i = 0; i < 25; i++) writeJsonAtomic(path, { i }, { mode: 0o600 });
    expect(readJson<{ i: number }>(path)).toEqual({ i: 24 });
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('readJson returns null for a missing or corrupt file', () => {
    const dir = tmp();
    expect(readJson(join(dir, 'missing.json'))).toBeNull();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(readJson(bad)).toBeNull();
  });

  it('readJson reads back what writeJsonAtomic wrote, with a trailing newline on disk', () => {
    const path = join(tmp(), 'state.json');
    writeJsonAtomic(path, { k: 'v' });
    expect(readFileSync(path, 'utf-8').endsWith('\n')).toBe(true);
  });
});
