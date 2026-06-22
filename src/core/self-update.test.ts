import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));

import { checkForUpdate, applyUpdate, resolveChannel } from './self-update';
import { execSafe } from './exec';

const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string) => ({ ok: false, stdout: '', stderr, exitCode: 1 });

const m = vi.mocked(execSafe);

beforeEach(() => vi.clearAllMocks());

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
  it('refuses when working tree is dirty', async () => {
    m.mockReturnValueOnce(ok(' M src/foo.ts'));    // dirty status
    const r = await applyUpdate();
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/dirty/);
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
