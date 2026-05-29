import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/self-update', () => ({
  checkForUpdate: vi.fn(),
  applyUpdate: vi.fn(),
  resolveChannel: vi.fn(),
}));

import { updateCommand } from './update';
import { checkForUpdate, applyUpdate, resolveChannel } from '../core/self-update';

const mockCheck = vi.mocked(checkForUpdate);
const mockApply = vi.mocked(applyUpdate);
const mockResolve = vi.mocked(resolveChannel);

const ctx = {
  confirm: async () => true,
  log: () => {},
  env: process.env,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockReturnValue({ channel: 'stable', branch: 'main' });
});

describe('fleet update', () => {
  it('reports up-to-date when no commits are behind', async () => {
    mockCheck.mockResolvedValue({
      available: false, behind: 0, latestSubject: '',
      branch: 'main', remoteBranch: 'main', channel: 'stable',
    });
    const args = updateCommand.args.parse({});
    const r = await updateCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.summary).toMatch(/up to date/);
    expect(r.data.available).toBeFalsy();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('with --check, reports availability without applying', async () => {
    mockCheck.mockResolvedValue({
      available: true, behind: 3, latestSubject: 'feat: x',
      branch: 'main', remoteBranch: 'main', channel: 'stable',
    });
    const args = updateCommand.args.parse({ check: true });
    const r = await updateCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.summary).toMatch(/3 commits ahead/);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('applies the update when an update is available and --check is not set', async () => {
    mockCheck.mockResolvedValue({
      available: true, behind: 2, latestSubject: 'fix: y',
      branch: 'main', remoteBranch: 'main', channel: 'stable',
    });
    mockApply.mockResolvedValue({ ok: true, pulled: 1, buildOk: true, output: 'Updated + rebuilt.' });
    const args = updateCommand.args.parse({});
    const r = await updateCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.summary).toMatch(/updated/);
    expect(r.data.pulled).toBe(1);
    expect(mockApply).toHaveBeenCalledOnce();
  });

  it('surfaces an apply failure as not ok', async () => {
    mockCheck.mockResolvedValue({
      available: true, behind: 2, latestSubject: 'fix: y',
      branch: 'main', remoteBranch: 'main', channel: 'stable',
    });
    mockApply.mockResolvedValue({ ok: false, pulled: 0, buildOk: false, output: 'non-ff' });
    const args = updateCommand.args.parse({});
    const r = await updateCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
    expect(r.summary).toMatch(/non-ff/);
  });

  it('surfaces a check failure as not ok', async () => {
    mockCheck.mockResolvedValue({
      available: false, behind: 0, latestSubject: '',
      branch: 'main', remoteBranch: 'main', channel: 'stable',
      error: 'fetch failed',
    });
    const args = updateCommand.args.parse({});
    const r = await updateCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
    expect(r.summary).toMatch(/fetch failed/);
  });

  it('--channel prerelease temporarily flips FLEET_UPDATE_CHANNEL during the call', async () => {
    let seen: string | undefined;
    mockCheck.mockImplementation(async () => {
      seen = process.env.FLEET_UPDATE_CHANNEL;
      return {
        available: false, behind: 0, latestSubject: '',
        branch: 'main', remoteBranch: 'develop', channel: 'prerelease',
      };
    });
    const previous = process.env.FLEET_UPDATE_CHANNEL;
    delete process.env.FLEET_UPDATE_CHANNEL;
    const args = updateCommand.args.parse({ channel: 'prerelease' });
    await updateCommand.run(args, ctx);
    expect(seen).toBe('prerelease');
    // env restored afterwards so subsequent commands don't inherit
    expect(process.env.FLEET_UPDATE_CHANNEL).toBeUndefined();
    if (previous) process.env.FLEET_UPDATE_CHANNEL = previous;
  });

  it('--branch sets FLEET_UPDATE_BRANCH during the call, restores after', async () => {
    let seen: string | undefined;
    mockCheck.mockImplementation(async () => {
      seen = process.env.FLEET_UPDATE_BRANCH;
      return {
        available: false, behind: 0, latestSubject: '',
        branch: 'main', remoteBranch: 'release/x', channel: 'stable',
      };
    });
    const previous = process.env.FLEET_UPDATE_BRANCH;
    delete process.env.FLEET_UPDATE_BRANCH;
    const args = updateCommand.args.parse({ branch: 'release/x' });
    await updateCommand.run(args, ctx);
    expect(seen).toBe('release/x');
    expect(process.env.FLEET_UPDATE_BRANCH).toBeUndefined();
    if (previous) process.env.FLEET_UPDATE_BRANCH = previous;
  });
});
