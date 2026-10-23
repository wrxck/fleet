import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../exec', () => ({ execSafe: vi.fn() }));

import { execSafe } from '../exec';

import { defaultScheduleFor, detectVolumes, mergeSnapshotPaths, resolveVolumeMountpoints } from './detect';

const exec = vi.mocked(execSafe);
const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr = 'Error response from daemon: get gone: no such volume') => ({ ok: false, stdout: '', stderr, exitCode: 1 });

describe('backup/detect', () => {
  it('apps with a db dump default to hourly', () => {
    expect(defaultScheduleFor(true)).toBe('hourly');
  });
  it('apps without a db default to daily', () => {
    expect(defaultScheduleFor(false)).toBe('daily');
  });
});

describe('backup/detect detectVolumes', () => {
  beforeEach(() => exec.mockReset());

  it('inspects only the registry containers when they are given', () => {
    exec.mockReturnValue(ok('macpool_macpool-data|'));
    expect(detectVolumes('macpool', ['macpool'])).toEqual(['macpool_macpool-data']);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1]).toEqual(['inspect', '--type', 'container', 'macpool', '--format', expect.any(String)]);
  });

  it('skips a stale registry name and keeps the others', () => {
    exec
      .mockReturnValueOnce(fail('Error: No such container: old'))
      .mockReturnValueOnce(ok('app_data|'));
    expect(detectVolumes('app', ['old', 'app'])).toEqual(['app_data']);
    expect(exec.mock.calls.some(c => (c[1] as string[]).includes('ps'))).toBe(false);
  });

  it('falls back to the name filter when no registry name inspects', () => {
    exec
      .mockReturnValueOnce(fail('Error: No such container: old'))
      .mockReturnValueOnce(ok('abc123\n'))
      .mockReturnValueOnce(ok('app_data|'));
    expect(detectVolumes('app', ['old'])).toEqual(['app_data']);
    expect(exec.mock.calls[1][1]).toEqual(['ps', '-q', '--filter', 'name=app']);
  });

  it('falls back to the docker name filter without registry containers', () => {
    exec
      .mockReturnValueOnce(ok('abc123\n'))
      .mockReturnValueOnce(ok('app_data|'));
    expect(detectVolumes('app')).toEqual(['app_data']);
    expect(exec.mock.calls[0][1]).toEqual(['ps', '-q', '--filter', 'name=app']);
  });

  it('skips anonymous volumes', () => {
    exec.mockReturnValue(ok(`${'a'.repeat(64)}|named|`));
    expect(detectVolumes('app', ['app'])).toEqual(['named']);
  });
});

describe('backup/detect resolveVolumeMountpoints', () => {
  beforeEach(() => exec.mockReset());

  it('returns the mountpoint of each known volume', () => {
    exec
      .mockReturnValueOnce(ok('/var/lib/docker/volumes/a/_data\n'))
      .mockReturnValueOnce(ok('/var/lib/docker/volumes/b/_data\n'));
    expect(resolveVolumeMountpoints(['a', 'b'])).toEqual({
      paths: ['/var/lib/docker/volumes/a/_data', '/var/lib/docker/volumes/b/_data'],
      missing: [],
    });
  });

  it('throws when docker itself fails, so a down daemon is not a silent skip', () => {
    exec.mockReturnValueOnce(fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'));
    expect(() => resolveVolumeMountpoints(['a'])).toThrow(/docker volume inspect a failed: Cannot connect/);
  });

  it('reports a volume docker does not know instead of throwing', () => {
    exec
      .mockReturnValueOnce(fail())
      .mockReturnValueOnce(ok('/var/lib/docker/volumes/b/_data\n'));
    expect(resolveVolumeMountpoints(['gone', 'b'])).toEqual({
      paths: ['/var/lib/docker/volumes/b/_data'],
      missing: ['gone'],
    });
  });

  it('does nothing for an empty list', () => {
    expect(resolveVolumeMountpoints([])).toEqual({ paths: [], missing: [] });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('backup/detect mergeSnapshotPaths', () => {
  it('keeps configured paths first and drops a volume path already configured', () => {
    expect(mergeSnapshotPaths(['/srv/app', '/var/lib/docker/volumes/a/_data'], ['/var/lib/docker/volumes/a/_data', '/var/lib/docker/volumes/b/_data']))
      .toEqual(['/srv/app', '/var/lib/docker/volumes/a/_data', '/var/lib/docker/volumes/b/_data']);
  });

  it('returns only the volume paths when no path is configured', () => {
    expect(mergeSnapshotPaths([], ['/v/a'])).toEqual(['/v/a']);
  });
});
