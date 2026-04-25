import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./exec.js', () => ({ execSafe: vi.fn() }));

import { checkForUpdate, applyUpdate } from './self-update.js';
import { execSafe } from './exec.js';

const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', exitCode: 0 });
const fail = (stderr: string) => ({ ok: false, stdout: '', stderr, exitCode: 1 });

const m = vi.mocked(execSafe);

beforeEach(() => vi.clearAllMocks());

describe('checkForUpdate', () => {
  it('returns available=false + behind=0 when local is up to date', async () => {
    m.mockReturnValueOnce(ok('develop'));   // rev-parse branch
    m.mockReturnValueOnce(ok(''));          // fetch
    m.mockReturnValueOnce(ok('0'));         // rev-list count
    const info = await checkForUpdate();
    expect(info).toEqual({ available: false, behind: 0, latestSubject: '', branch: 'develop' });
  });

  it('returns available=true + commit subject when behind', async () => {
    m.mockReturnValueOnce(ok('develop'));
    m.mockReturnValueOnce(ok(''));
    m.mockReturnValueOnce(ok('3'));
    m.mockReturnValueOnce(ok('feat: add new logs view'));
    const info = await checkForUpdate();
    expect(info.available).toBe(true);
    expect(info.behind).toBe(3);
    expect(info.latestSubject).toBe('feat: add new logs view');
  });

  it('handles fetch failure gracefully', async () => {
    m.mockReturnValueOnce(ok('develop'));
    m.mockReturnValueOnce(fail('connection refused'));
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
    expect(info.error).toBe('fetch failed');
  });

  it('handles missing repo (rev-parse fail)', async () => {
    m.mockReturnValueOnce(fail('not a git repo'));
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
    expect(info.branch).toBe('?');
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
});
