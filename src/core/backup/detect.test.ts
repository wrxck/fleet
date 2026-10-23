import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../exec', () => ({ execSafe: vi.fn() }));

import { execSafe } from '../exec';

import { defaultScheduleFor, detectVolumes, resolveVolumeMountpoints } from './detect';

const exec = vi.mocked(execSafe);
const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = () => ({ ok: false, stdout: '', stderr: 'no such volume', exitCode: 1 });

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
    expect(exec.mock.calls[0][1]).toContain('macpool');
    expect(exec.mock.calls.some(c => (c[1] as string[]).includes('ps'))).toBe(false);
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
