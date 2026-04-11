import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('./validate.js', () => ({
  assertServiceName: vi.fn(),
}));

import { execSafe } from './exec.js';
import { getServiceStatus, getMultipleServiceStatuses } from './systemd.js';

const mockedExec = vi.mocked(execSafe);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getServiceStatus', () => {
  it('parses active enabled service in a single exec call', () => {
    mockedExec.mockReturnValue({
      stdout: 'ActiveState=active\nUnitFileState=enabled\nDescription=My App Docker Service',
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getServiceStatus('my-app');

    expect(result).toEqual({
      name: 'my-app',
      active: true,
      enabled: true,
      state: 'active',
      description: 'My App Docker Service',
    });
    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedExec).toHaveBeenCalledWith(
      'systemctl',
      expect.arrayContaining(['show', 'my-app.service']),
    );
  });

  it('parses inactive disabled service', () => {
    mockedExec.mockReturnValue({
      stdout: 'ActiveState=inactive\nUnitFileState=disabled\nDescription=',
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getServiceStatus('stopped-app');

    expect(result.active).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.state).toBe('inactive');
    expect(result.description).toBe('');
  });

  it('parses failed service', () => {
    mockedExec.mockReturnValue({
      stdout: 'ActiveState=failed\nUnitFileState=enabled\nDescription=Broken App',
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getServiceStatus('broken');

    expect(result.active).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.enabled).toBe(true);
  });

  it('handles empty output gracefully', () => {
    mockedExec.mockReturnValue({
      stdout: '',
      stderr: '',
      exitCode: 1,
      ok: false,
    });

    const result = getServiceStatus('nonexistent');

    expect(result.active).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.state).toBe('unknown');
  });

  it('handles Description containing = sign', () => {
    mockedExec.mockReturnValue({
      stdout: 'ActiveState=active\nUnitFileState=enabled\nDescription=App with key=value in desc',
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getServiceStatus('edge-case');

    expect(result.description).toBe('App with key=value in desc');
  });
});

describe('getMultipleServiceStatuses', () => {
  it('returns empty map for empty input', () => {
    const result = getMultipleServiceStatuses([]);

    expect(result.size).toBe(0);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('parses multiple services from batch output', () => {
    mockedExec.mockReturnValue({
      stdout: [
        'Id=app-a.service',
        'ActiveState=active',
        'UnitFileState=enabled',
        'Description=App A',
        '',
        'Id=app-b.service',
        'ActiveState=inactive',
        'UnitFileState=disabled',
        'Description=App B',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getMultipleServiceStatuses(['app-a', 'app-b']);

    expect(result.size).toBe(2);
    expect(result.get('app-a')).toEqual({
      name: 'app-a',
      active: true,
      enabled: true,
      state: 'active',
      description: 'App A',
    });
    expect(result.get('app-b')).toEqual({
      name: 'app-b',
      active: false,
      enabled: false,
      state: 'inactive',
      description: 'App B',
    });
  });

  it('queries all services in a single exec call', () => {
    mockedExec.mockReturnValue({
      stdout: [
        'Id=s1.service',
        'ActiveState=active',
        'UnitFileState=enabled',
        'Description=S1',
        '',
        'Id=s2.service',
        'ActiveState=active',
        'UnitFileState=enabled',
        'Description=S2',
        '',
        'Id=s3.service',
        'ActiveState=active',
        'UnitFileState=enabled',
        'Description=S3',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    getMultipleServiceStatuses(['s1', 's2', 's3']);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedExec).toHaveBeenCalledWith(
      'systemctl',
      expect.arrayContaining(['show', 's1.service', 's2.service', 's3.service']),
      expect.any(Object),
    );
  });

  it('handles empty output gracefully', () => {
    mockedExec.mockReturnValue({
      stdout: '',
      stderr: 'error',
      exitCode: 1,
      ok: false,
    });

    const result = getMultipleServiceStatuses(['missing']);

    expect(result.size).toBe(0);
  });

  it('strips .service suffix from Id correctly', () => {
    mockedExec.mockReturnValue({
      stdout: 'Id=my-service.service\nActiveState=active\nUnitFileState=enabled\nDescription=Test',
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getMultipleServiceStatuses(['my-service']);

    expect(result.has('my-service')).toBe(true);
    expect(result.get('my-service')?.name).toBe('my-service');
  });

  it('only strips trailing .service suffix', () => {
    mockedExec.mockReturnValue({
      stdout: 'Id=my-service-service.service\nActiveState=active\nUnitFileState=enabled\nDescription=Test',
      stderr: '',
      exitCode: 0,
      ok: true,
    });

    const result = getMultipleServiceStatuses(['my-service-service']);

    expect(result.has('my-service-service')).toBe(true);
  });
});
