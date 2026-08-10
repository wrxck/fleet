import { describe, it, expect, vi } from 'vitest';

vi.mock('./exec.js', () => ({ execSafe: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })) }));

import {
  effectivePolicy,
  buildComposeOverride,
  DEFAULT_POLICY,
  readContainerLogs,
} from './logs-policy';
import type { AppEntry } from './registry';
import { execSafe } from './exec';
import { effectiveRedaction } from './redaction';

function app(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'poolside',
    displayName: 'poolside',
    composePath: '/tmp/poolside',
    composeFile: null,
    serviceName: 'poolside',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['poolside'],
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
    const out = readContainerLogs('poolside', { lines: 30, sinceMinutes: 5 });
    expect(execSafe).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['logs', '--tail', '30', '--since', '5m', 'poolside']),
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
  it('keeps unlabelled lines under a level filter (the logs_recent regression)', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: 'server running at http://localhost:3007\nINFO routine ping\nWARN trouble',
      stderr: '',
    });
    const out = readContainerLogs('m', { level: 'warn' });
    // the plain startup line has no level token, so it must survive...
    expect(out.text).toContain('server running at http://localhost:3007');
    expect(out.text).toContain('WARN trouble');
    // ...while an explicitly lower-level line is still dropped.
    expect(out.text).not.toContain('INFO routine ping');
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
    expect(out.truncated).toBeTruthy();
    expect(out.text.length).toBe(100);
  });
});

describe('readContainerLogs redaction', () => {
  const TOKEN = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';

  it('redacts by default', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: `boot ok\nGH_TOKEN=${TOKEN}\nuser alice@example.com signed in`,
      stderr: '',
    });
    const out = readContainerLogs('m');
    expect(out.text).not.toContain(TOKEN);
    expect(out.text).not.toContain('alice@example.com');
    expect(out.text).toContain('boot ok');
    expect(out.text).toMatch(/GH_TOKEN=\[REDACTED:provider_token#[0-9a-f]{4}\]/);
    expect(out.redacted).toEqual({ provider_token: 1, email: 1 });
  });

  it('honours a per-app config that disables redaction', () => {
    vi.mocked(execSafe).mockReturnValueOnce({ ok: true, stdout: `GH_TOKEN=${TOKEN}`, stderr: '' });
    const out = readContainerLogs('m', { redaction: effectiveRedaction(app({ logging: { redaction: { enabled: false } } })) });
    expect(out.text).toBe(`GH_TOKEN=${TOKEN}`);
  });

  it('honours a per-app allowlist', () => {
    vi.mocked(execSafe).mockReturnValueOnce({ ok: true, stdout: 'ops@fleet.internal and alice@example.com', stderr: '' });
    const cfg = effectiveRedaction(app({ logging: { redaction: { allowlist: ['ops@fleet.internal'] } } }));
    const out = readContainerLogs('m', { redaction: cfg });
    expect(out.text).toContain('ops@fleet.internal');
    expect(out.text).not.toContain('alice@example.com');
  });

  it('greps against the RAW line, then redacts the survivors', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: 'other line\nlogin for alice@example.com from web\ntrailing line',
      stderr: '',
    });
    // the documented ordering: matching on raw text keeps grep useful for
    // operators, and the value still never reaches the caller.
    const out = readContainerLogs('m', { grep: 'alice@example.com' });
    expect(out.text.split('\n').filter(Boolean)).toHaveLength(1);
    expect(out.text).toContain('login for');
    expect(out.text).toContain('from web');
    expect(out.text).not.toContain('alice@example.com');
  });

  it('greps against raw text even for a level-filtered read', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: true,
      stdout: 'INFO quiet\nERROR auth failed for alice@example.com\nERROR unrelated',
      stderr: '',
    });
    const out = readContainerLogs('m', { level: 'error', grep: 'alice@' });
    expect(out.text.split('\n').filter(Boolean)).toHaveLength(1);
    expect(out.text).toMatch(/ERROR auth failed for \[REDACTED:email#[0-9a-f]{4}\]/);
  });

  it('redacts BEFORE the size cap so truncation cannot leave half a secret', () => {
    vi.mocked(execSafe).mockReturnValueOnce({ ok: true, stdout: `${'A'.repeat(20)} ${TOKEN}`, stderr: '' });
    const out = readContainerLogs('m', { maxBytes: 30 });
    expect(out.truncated).toBeTruthy();
    expect(out.text).not.toContain('ghp_');
    expect(out.text).not.toContain('1234567890');
  });

  it('redacts docker stderr on the failure path too', () => {
    vi.mocked(execSafe).mockReturnValueOnce({
      ok: false,
      stdout: '',
      stderr: 'Error response from daemon: bad auth alice@example.com',
    });
    const out = readContainerLogs('m');
    expect(out.text).not.toContain('alice@example.com');
    expect(out.text).toContain('Error response from daemon');
  });
});

describe('ensureFleetGitignored', () => {
  // these tests touch real filesystem under a tmpdir — vi.mock('node:fs') is
  // not used in this file, so writes / reads land on disk and we clean up.

  it('no-ops when .gitignore is missing', async () => {
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ensureFleetGitignored } = await import('./logs-policy');

    const dir = mkdtempSync(join(tmpdir(), 'fleet-gi-'));
    try {
      ensureFleetGitignored(dir);
      expect(existsSync(join(dir, '.gitignore'))).toBeFalsy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends .fleet/ when missing', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ensureFleetGitignored } = await import('./logs-policy');

    const dir = mkdtempSync(join(tmpdir(), 'fleet-gi-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n');
      ensureFleetGitignored(dir);
      const after = readFileSync(join(dir, '.gitignore'), 'utf-8');
      expect(after).toMatch(/\.fleet\//);
      expect(after).toMatch(/auto-added by fleet logs setup/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent — does not append a duplicate entry', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ensureFleetGitignored } = await import('./logs-policy');

    const dir = mkdtempSync(join(tmpdir(), 'fleet-gi-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.fleet/\n');
      ensureFleetGitignored(dir);
      ensureFleetGitignored(dir);
      const after = readFileSync(join(dir, '.gitignore'), 'utf-8');
      const matches = after.match(/\.fleet\//g) ?? [];
      expect(matches.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts existing entries in any common form (.fleet, /.fleet, .fleet/, /.fleet/)', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { ensureFleetGitignored } = await import('./logs-policy');

    for (const variant of ['.fleet', '/.fleet', '.fleet/', '/.fleet/']) {
      const dir = mkdtempSync(join(tmpdir(), 'fleet-gi-'));
      try {
        writeFileSync(join(dir, '.gitignore'), `${variant}\n`);
        ensureFleetGitignored(dir);
        const after = readFileSync(join(dir, '.gitignore'), 'utf-8');
        expect(after).not.toMatch(/auto-added/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
