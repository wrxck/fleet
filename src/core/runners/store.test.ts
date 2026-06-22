import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRunners, removeRunner, saveRunners, upsertRunner } from './store';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fleet-runners-'));
  path = join(dir, 'runners.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runner registry store', () => {
  it('returns an empty map when the file is absent', () => {
    expect(loadRunners(path)).toEqual({});
  });

  it('round-trips a host through upsert and load', () => {
    upsertRunner('mac-mini', { destination: 'matt@localhost', port: 2222, identityFile: '/k/id' }, path);
    const hosts = loadRunners(path);
    expect(hosts['mac-mini']).toEqual({ destination: 'matt@localhost', port: 2222, identityFile: '/k/id' });
  });

  it('updates an existing host in place', () => {
    upsertRunner('h', { destination: 'a@x' }, path);
    upsertRunner('h', { destination: 'b@y', defaultCwd: '/build' }, path);
    expect(loadRunners(path)).toEqual({ h: { destination: 'b@y', defaultCwd: '/build' } });
  });

  it('removes a host and reports whether it existed', () => {
    upsertRunner('h', { destination: 'a@x' }, path);
    expect(removeRunner('h', path)).toBeTruthy();
    expect(removeRunner('h', path)).toBeFalsy();
    expect(loadRunners(path)).toEqual({});
  });

  it('tolerates a corrupt registry file', () => {
    saveRunners({ a: { destination: 'a@x' } }, path);
    // overwrite with junk
    rmSync(path);
    expect(loadRunners(path)).toEqual({});
  });
});
