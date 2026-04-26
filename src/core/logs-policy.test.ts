import { describe, it, expect, vi } from 'vitest';

vi.mock('./exec.js', () => ({ execSafe: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })) }));

import {
  effectivePolicy,
  buildComposeOverride,
  DEFAULT_POLICY,
  readContainerLogs,
} from './logs-policy.js';
import type { AppEntry } from './registry.js';
import { execSafe } from './exec.js';

function app(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'macpool',
    displayName: 'macpool',
    composePath: '/tmp/macpool',
    composeFile: null,
    serviceName: 'macpool',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['macpool'],
    dependsOnDatabases: false,
    registeredAt: '',
    ...overrides,
  };
}

describe('effectivePolicy', () => {
  it('returns defaults when nothing configured', () => {
    expect(effectivePolicy(app())).toEqual(DEFAULT_POLICY);
  });
  it('overrides only what is set', () => {
    expect(effectivePolicy(app({ logging: { maxSizeMB: 50 } }))).toEqual({ ...DEFAULT_POLICY, maxSizeMB: 50 });
  });
  it('respects level override', () => {
    expect(effectivePolicy(app({ logging: { level: 'error' } })).level).toBe('error');
  });
});

describe('buildComposeOverride', () => {
  it('emits json-file driver per container', () => {
    const out = buildComposeOverride(
      app({ containers: ['svc-a', 'svc-b'] }),
      { retentionDays: 7, maxSizeMB: 100, level: 'info' },
    );
    expect(out).toContain('svc-a:');
    expect(out).toContain('svc-b:');
    expect(out).toContain('driver: json-file');
    expect(out).toContain('"100m"');
  });
  it('uses configured maxSizeMB', () => {
    expect(buildComposeOverride(app(), { retentionDays: 7, maxSizeMB: 250, level: 'info' })).toContain('"250m"');
  });
});

describe('readContainerLogs', () => {
  it('passes lines + since to docker', () => {
    vi.mocked(execSafe).mockReturnValueOnce({ ok: true, stdout: 'line1\nline2', stderr: '' });
    const out = readContainerLogs('macpool', { lines: 30, sinceMinutes: 5 });
    expect(execSafe).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['logs', '--tail', '30', '--since', '5m', 'macpool']),
    );
    expect(out.text).toBe('line1\nline2');
  });
  it('filters by level=warn (drops info/debug)', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: 'INFO ok\nWARN trouble\nERROR bad\nDEBUG noise',
      stderr: '',
    });
    const out = readContainerLogs('m', { level: 'warn' });
    expect(out.text).toContain('WARN trouble');
    expect(out.text).toContain('ERROR bad');
    expect(out.text).not.toContain('DEBUG noise');
  });
  it('grep filter applied after level', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: 'ERROR alpha\nERROR beta\nERROR gamma',
      stderr: '',
    });
    const out = readContainerLogs('m', { level: 'error', grep: 'beta' });
    expect(out.text.split('\n').filter(Boolean)).toEqual(['ERROR beta']);
  });
  it('truncates and reports', () => {
    vi.mocked(execSafe).mockReturnValueOnce({ ok: true, stdout: 'x'.repeat(500_000), stderr: '' });
    const out = readContainerLogs('m', { maxBytes: 100 });
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(100);
  });
});
