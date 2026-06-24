import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  it('leaves no .tmp sibling behind', () => {
    const path = join(tmp(), 'state.json');
    writeJsonAtomic(path, { ok: true });
    expect(() => statSync(`${path}.tmp`)).toThrow();
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
