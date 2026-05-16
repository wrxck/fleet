import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { isAppendOnly, parseLsOutput, dumpFileArgs } from './repo';

describe('isAppendOnly', () => {
  const original = process.env.FLEET_BACKUP_BASE_URL;
  beforeEach(() => { delete process.env.FLEET_BACKUP_BASE_URL; });
  afterEach(() => {
    if (original === undefined) delete process.env.FLEET_BACKUP_BASE_URL;
    else process.env.FLEET_BACKUP_BASE_URL = original;
  });

  it('returns false when no base url is set (legacy sftp default)', () => {
    expect(isAppendOnly()).toBe(false);
  });

  it('returns true for rest: backends', () => {
    process.env.FLEET_BACKUP_BASE_URL = 'rest:http://10.99.0.2:14739';
    expect(isAppendOnly()).toBe(true);
  });

  it('returns true for rest:https:// backends', () => {
    process.env.FLEET_BACKUP_BASE_URL = 'rest:https://example.invalid';
    expect(isAppendOnly()).toBe(true);
  });

  it('returns false for explicit sftp: base url', () => {
    process.env.FLEET_BACKUP_BASE_URL = 'sftp:somehost:';
    expect(isAppendOnly()).toBe(false);
  });

  it('returns false for s3: backends (no append-only enforcement by default)', () => {
    process.env.FLEET_BACKUP_BASE_URL = 's3:s3.amazonaws.com/bucket';
    expect(isAppendOnly()).toBe(false);
  });
});

describe('backup/repo parseLsOutput', () => {
  const lines = [
    JSON.stringify({ struct_type: 'snapshot', id: 'abc', short_id: 'abc' }),
    JSON.stringify({ struct_type: 'node', name: 'app', type: 'dir', path: '/home/app', size: 0, mtime: '2026-05-01T00:00:00Z' }),
    JSON.stringify({ struct_type: 'node', name: 'index.ts', type: 'file', path: '/home/app/index.ts', size: 120, mtime: '2026-05-01T00:00:00Z' }),
    JSON.stringify({ struct_type: 'node', name: 'readme', type: 'file', path: '/home/readme', size: 5, mtime: '2026-05-01T00:00:00Z' }),
  ].join('\n');

  it('returns only direct children of the requested dir', () => {
    const entries = parseLsOutput(lines, '/home');
    expect(entries.map(e => e.name).sort()).toEqual(['app', 'readme']);
  });

  it('excludes deeper descendants', () => {
    const entries = parseLsOutput(lines, '/home');
    expect(entries.find(e => e.name === 'index.ts')).toBeUndefined();
  });

  it('sorts directories before files, then alphabetically', () => {
    const entries = parseLsOutput(lines, '/home');
    expect(entries[0]).toMatchObject({ name: 'app', type: 'dir' });
    expect(entries[1]).toMatchObject({ name: 'readme', type: 'file' });
  });

  it('lists children of nested dirs', () => {
    const entries = parseLsOutput(lines, '/home/app');
    expect(entries.map(e => e.name)).toEqual(['index.ts']);
  });

  it('handles the snapshot root', () => {
    const rootLines = [
      JSON.stringify({ struct_type: 'node', name: 'etc', type: 'dir', path: '/etc', size: 0, mtime: '' }),
      JSON.stringify({ struct_type: 'node', name: 'passwd', type: 'file', path: '/etc/passwd', size: 1, mtime: '' }),
    ].join('\n');
    const entries = parseLsOutput(rootLines, '/');
    expect(entries.map(e => e.name)).toEqual(['etc']);
  });

  it('ignores non-node and malformed lines', () => {
    const messy = [
      'not json',
      JSON.stringify({ struct_type: 'snapshot' }),
      JSON.stringify({ struct_type: 'node', name: 'x', type: 'file', path: '/home/x', size: 0, mtime: '' }),
    ].join('\n');
    expect(parseLsOutput(messy, '/home').map(e => e.name)).toEqual(['x']);
  });
});

describe('backup/repo dumpFileArgs', () => {
  it('builds restic dump args with repo and snapshot', () => {
    const args = dumpFileArgs('myapp', 'abc12345', '/etc/hosts');
    expect(args[0]).toBe('-r');
    expect(args).toContain('dump');
    expect(args).toContain('abc12345');
    expect(args).toContain('/etc/hosts');
  });
});
