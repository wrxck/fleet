import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

import { existsSync, readFileSync } from 'node:fs';

import {
  checkForUpdate,
  applyUpdate,
  resolveChannel,
  detectInstallKind,
  compareVersions,
} from './self-update';
import { execSafe } from './exec';

const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string) => ({ ok: false, stdout: '', stderr, exitCode: 1 });

const m = vi.mocked(execSafe);
const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  // default to the git-checkout install kind every pre-existing test assumes.
  mockExists.mockReturnValue(true);
});

// channel selection covers the three documented routes: default, env-opt-in,
// explicit branch override (for forks / custom workflows).
describe('resolveChannel', () => {
  const original = {
    channel: process.env.FLEET_UPDATE_CHANNEL,
    branch: process.env.FLEET_UPDATE_BRANCH,
  };
  afterEach(() => {
    delete process.env.FLEET_UPDATE_CHANNEL;
    delete process.env.FLEET_UPDATE_BRANCH;
    if (original.channel) process.env.FLEET_UPDATE_CHANNEL = original.channel;
    if (original.branch) process.env.FLEET_UPDATE_BRANCH = original.branch;
  });

  it('defaults to stable / main', () => {
    delete process.env.FLEET_UPDATE_CHANNEL;
    delete process.env.FLEET_UPDATE_BRANCH;
    expect(resolveChannel()).toEqual({ channel: 'stable', branch: 'main' });
  });

  it('opts into prerelease / develop via FLEET_UPDATE_CHANNEL', () => {
    process.env.FLEET_UPDATE_CHANNEL = 'prerelease';
    expect(resolveChannel()).toEqual({ channel: 'prerelease', branch: 'develop' });
  });

  it('FLEET_UPDATE_BRANCH overrides everything', () => {
    process.env.FLEET_UPDATE_CHANNEL = 'prerelease';
    process.env.FLEET_UPDATE_BRANCH = 'release/2026.q3';
    expect(resolveChannel()).toEqual({ channel: 'stable', branch: 'release/2026.q3' });
  });

  it('FLEET_UPDATE_BRANCH=develop reports prerelease channel', () => {
    process.env.FLEET_UPDATE_BRANCH = 'develop';
    expect(resolveChannel()).toEqual({ channel: 'prerelease', branch: 'develop' });
  });
});

describe('checkForUpdate', () => {
  it('returns available=false + behind=0 when local is up to date', async () => {
    m.mockReturnValueOnce(ok('main'));      // rev-parse branch
    m.mockReturnValueOnce(ok(''));          // fetch
    m.mockReturnValueOnce(ok('0'));         // rev-list count
    const info = await checkForUpdate();
    expect(info).toEqual({
      available: false, behind: 0, latestSubject: '',
      branch: 'main', remoteBranch: 'main', channel: 'stable',
    });
  });

  it('fetches the configured channel branch, not the local HEAD branch', async () => {
    process.env.FLEET_UPDATE_CHANNEL = 'prerelease';
    m.mockReturnValueOnce(ok('main'));      // local is on main
    m.mockReturnValueOnce(ok(''));          // fetch
    m.mockReturnValueOnce(ok('0'));         // count
    await checkForUpdate();
    delete process.env.FLEET_UPDATE_CHANNEL;
    const fetchCall = m.mock.calls[1];
    expect(fetchCall[1]).toEqual(['-C', expect.any(String), 'fetch', '--quiet', 'origin', 'develop']);
    const countCall = m.mock.calls[2];
    expect(countCall[1]).toEqual([
      '-C', expect.any(String), 'rev-list', '--count', 'HEAD..origin/develop',
    ]);
  });

  it('returns available=true + commit subject when behind', async () => {
    m.mockReturnValueOnce(ok('main'));
    m.mockReturnValueOnce(ok(''));
    m.mockReturnValueOnce(ok('3'));
    m.mockReturnValueOnce(ok('feat: add new logs view'));
    const info = await checkForUpdate();
    expect(info.available).toBeTruthy();
    expect(info.behind).toBe(3);
    expect(info.latestSubject).toBe('feat: add new logs view');
    expect(info.channel).toBe('stable');
    expect(info.remoteBranch).toBe('main');
  });

  it('handles fetch failure gracefully', async () => {
    m.mockReturnValueOnce(ok('main'));
    m.mockReturnValueOnce(fail('connection refused'));
    const info = await checkForUpdate();
    expect(info.available).toBeFalsy();
    expect(info.error).toBe('fetch failed');
    expect(info.channel).toBe('stable');
  });

  it('handles missing repo (rev-parse fail)', async () => {
    m.mockReturnValueOnce(fail('not a git repo'));
    const info = await checkForUpdate();
    expect(info.available).toBeFalsy();
    expect(info.branch).toBe('?');
    expect(info.remoteBranch).toBe('main');
  });
});

describe('applyUpdate', () => {
  it('refuses when tracked files have uncommitted changes', async () => {
    m.mockReturnValueOnce(ok(' M src/foo.ts'));    // dirty status
    const r = await applyUpdate();
    expect(r.ok).toBeFalsy();
    expect(r.output).toMatch(/uncommitted changes to tracked files/);
  });

  it('asks git to ignore untracked files in the dirtiness check', async () => {
    // untracked scratch (logs, backups) must not block self-update — an
    // ff-only pull cannot clobber it. the flag makes porcelain exclude it.
    m.mockReturnValueOnce(ok(''));            // status clean of tracked changes
    m.mockReturnValueOnce(ok('aaa1111'));     // pre HEAD
    m.mockReturnValueOnce(ok(''));            // pull
    m.mockReturnValueOnce(ok('aaa1111'));     // post HEAD
    m.mockReturnValueOnce(ok('built'));       // build
    const r = await applyUpdate();
    expect(r.ok).toBeTruthy();
    expect(m.mock.calls[0][1]).toContain('--untracked-files=no');
  });

  it('pulls + rebuilds when clean and updates land', async () => {
    m.mockReturnValueOnce(ok(''));            // status clean
    m.mockReturnValueOnce(ok('aaa1111'));     // pre HEAD
    m.mockReturnValueOnce(ok(''));            // pull
    m.mockReturnValueOnce(ok('bbb2222'));     // post HEAD (changed)
    m.mockReturnValueOnce(ok('built'));       // npm run build
    const r = await applyUpdate();
    expect(r.ok).toBe(true);
    expect(r.pulled).toBe(1);
    expect(r.buildOk).toBe(true);
    expect(r.output).toMatch(/Updated/);
  });

  it('reports already-up-to-date when HEAD did not change', async () => {
    m.mockReturnValueOnce(ok(''));            // status clean
    m.mockReturnValueOnce(ok('aaa1111'));     // pre
    m.mockReturnValueOnce(ok(''));            // pull (no changes)
    m.mockReturnValueOnce(ok('aaa1111'));     // post (same)
    m.mockReturnValueOnce(ok('built'));       // build still runs (idempotent)
    const r = await applyUpdate();
    expect(r.ok).toBe(true);
    expect(r.pulled).toBe(0);
    expect(r.output).toMatch(/Already up to date/);
  });

  it('returns failure on pull error', async () => {
    m.mockReturnValueOnce(ok(''));            // status clean
    m.mockReturnValueOnce(ok('aaa1111'));     // pre
    m.mockReturnValueOnce(fail('non-ff'));    // pull
    const r = await applyUpdate();
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/non-ff/);
  });

  describe('with FLEET_UPDATE_VERIFY enabled', () => {
    afterEach(() => { delete process.env.FLEET_UPDATE_VERIFY; });

    it('builds when the pulled commit verifies', async () => {
      process.env.FLEET_UPDATE_VERIFY = '1';
      m.mockReturnValueOnce(ok(''));            // status clean
      m.mockReturnValueOnce(ok('aaa1111'));     // pre HEAD
      m.mockReturnValueOnce(ok(''));            // pull
      m.mockReturnValueOnce(ok('bbb2222'));     // post HEAD (changed)
      m.mockReturnValueOnce(ok('Good signature')); // verify-commit
      m.mockReturnValueOnce(ok('built'));       // npm run build
      const r = await applyUpdate();
      expect(r.ok).toBe(true);
      expect(r.buildOk).toBe(true);
      const verifyCall = m.mock.calls[4];
      expect(verifyCall[1]).toContain('verify-commit');
      expect(verifyCall[1]).toContain('bbb2222');
    });

    it('refuses to build and rolls back when the pulled commit fails verification', async () => {
      process.env.FLEET_UPDATE_VERIFY = '1';
      m.mockReturnValueOnce(ok(''));            // status clean
      m.mockReturnValueOnce(ok('aaa1111'));     // pre HEAD
      m.mockReturnValueOnce(ok(''));            // pull
      m.mockReturnValueOnce(ok('bbb2222'));     // post HEAD (changed)
      m.mockReturnValueOnce(fail('no signature')); // verify-commit fails
      m.mockReturnValueOnce(ok(''));            // reset --hard
      const r = await applyUpdate();
      expect(r.ok).toBe(false);
      expect(r.buildOk).toBe(false);
      expect(r.output).toMatch(/failed signature verification/);
      // the rollback ran, and crucially npm build did NOT.
      const resetCall = m.mock.calls[5];
      expect(resetCall[1]).toEqual(['-C', expect.any(String), 'reset', '--hard', 'aaa1111']);
      const builtABuild = m.mock.calls.some(c => c[0] === 'npm');
      expect(builtABuild).toBe(false);
    });

    it('skips verification when nothing was pulled', async () => {
      process.env.FLEET_UPDATE_VERIFY = '1';
      m.mockReturnValueOnce(ok(''));            // status clean
      m.mockReturnValueOnce(ok('aaa1111'));     // pre
      m.mockReturnValueOnce(ok(''));            // pull
      m.mockReturnValueOnce(ok('aaa1111'));     // post (unchanged)
      m.mockReturnValueOnce(ok('built'));       // build
      const r = await applyUpdate();
      expect(r.ok).toBe(true);
      const ranVerify = m.mock.calls.some(c => Array.isArray(c[1]) && (c[1] as string[]).includes('verify-commit'));
      expect(ranVerify).toBe(false);
    });
  });
});

describe('compareVersions', () => {
  it('orders plain x.y.z versions', () => {
    expect(compareVersions('1.15.1', '1.15.0')).toBeGreaterThan(0);
    expect(compareVersions('1.15.0', '1.15.1')).toBeLessThan(0);
    expect(compareVersions('1.15.0', '1.15.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('v1.16.0', '1.15.9')).toBeGreaterThan(0);
  });
});

// npm-install mode: no .git at the package root, path under node_modules.
describe('npm-install mode', () => {
  const NPM_ROOT = '/usr/lib/node_modules/@matthesketh/fleet';
  const pkg = (version: string) => JSON.stringify({ version });

  beforeEach(() => {
    process.env.FLEET_REPO_PATH = NPM_ROOT;
    mockExists.mockReturnValue(false);
  });
  afterEach(() => {
    delete process.env.FLEET_REPO_PATH;
    delete process.env.FLEET_UPDATE_CHANNEL;
    delete process.env.FLEET_UPDATE_BRANCH;
  });

  it('detects a global npm install', () => {
    expect(detectInstallKind()).toBe('npm');
  });

  it('detects a git checkout when .git exists', () => {
    mockExists.mockReturnValue(true);
    expect(detectInstallKind()).toBe('git');
  });

  it('detects an unknown install (no .git, not under node_modules)', () => {
    process.env.FLEET_REPO_PATH = '/opt/fleet';
    expect(detectInstallKind()).toBe('unknown');
  });

  it('check reports an available update from the registry', async () => {
    mockRead.mockReturnValue(pkg('1.15.0'));
    m.mockReturnValueOnce(ok('1.15.1'));
    const info = await checkForUpdate();
    expect(m).toHaveBeenCalledWith(
      'npm', ['view', '@matthesketh/fleet', 'version'], { timeout: 15_000 },
    );
    expect(info.kind).toBe('npm');
    expect(info.available).toBeTruthy();
    expect(info.localVersion).toBe('1.15.0');
    expect(info.remoteVersion).toBe('1.15.1');
    expect(info.latestSubject).toBe('v1.15.1');
  });

  it('check reports up to date when the registry matches', async () => {
    mockRead.mockReturnValue(pkg('1.15.1'));
    m.mockReturnValueOnce(ok('1.15.1'));
    const info = await checkForUpdate();
    expect(info.available).toBeFalsy();
    expect(info.error).toBeUndefined();
  });

  it('check surfaces a registry failure without throwing', async () => {
    mockRead.mockReturnValue(pkg('1.15.0'));
    m.mockReturnValueOnce(fail('network down'));
    const info = await checkForUpdate();
    expect(info.available).toBeFalsy();
    expect(info.error).toMatch(/registry/);
  });

  it('refuses channel overrides in npm mode without hitting the registry', async () => {
    process.env.FLEET_UPDATE_CHANNEL = 'prerelease';
    mockRead.mockReturnValue(pkg('1.15.0'));
    const info = await checkForUpdate();
    expect(info.available).toBeFalsy();
    expect(info.error).toMatch(/git checkout/);
    expect(m).not.toHaveBeenCalled();
  });

  it('check on an unknown install fails with reinstall guidance', async () => {
    process.env.FLEET_REPO_PATH = '/opt/fleet';
    mockRead.mockReturnValue(pkg('1.15.0'));
    const info = await checkForUpdate();
    expect(info.kind).toBe('unknown');
    expect(info.available).toBeFalsy();
    expect(info.error).toMatch(/npm install -g @matthesketh\/fleet/);
    expect(m).not.toHaveBeenCalled();
  });

  it('apply installs the latest package and reports the version change', async () => {
    mockRead.mockReturnValueOnce(pkg('1.15.0')).mockReturnValueOnce(pkg('1.15.1'));
    m.mockReturnValueOnce(ok(''));
    const r = await applyUpdate();
    expect(m).toHaveBeenCalledWith(
      'npm', ['install', '-g', '@matthesketh/fleet@latest'], { timeout: 300_000 },
    );
    expect(r).toEqual({
      ok: true,
      pulled: 1,
      buildOk: true,
      output: 'Updated @matthesketh/fleet v1.15.0 -> v1.15.1.',
    });
  });

  it('apply reports already-up-to-date when the version does not change', async () => {
    mockRead.mockReturnValue(pkg('1.15.1'));
    m.mockReturnValueOnce(ok(''));
    const r = await applyUpdate();
    expect(r.ok).toBeTruthy();
    expect(r.pulled).toBe(0);
    expect(r.output).toMatch(/Already up to date/);
  });

  it('apply surfaces npm failure output', async () => {
    mockRead.mockReturnValue(pkg('1.15.0'));
    m.mockReturnValueOnce(fail('EACCES: permission denied'));
    const r = await applyUpdate();
    expect(r.ok).toBeFalsy();
    expect(r.output).toMatch(/EACCES/);
  });

  it('refuses to apply on an unknown install with reinstall guidance', async () => {
    process.env.FLEET_REPO_PATH = '/opt/fleet';
    const r = await applyUpdate();
    expect(r.ok).toBeFalsy();
    expect(r.output).toMatch(/npm install -g @matthesketh\/fleet/);
    expect(m).not.toHaveBeenCalled();
  });
});
