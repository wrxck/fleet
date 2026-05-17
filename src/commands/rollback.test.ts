import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry');
  return { ...actual, load: vi.fn(), findApp: vi.fn() };
});
vi.mock('../core/exec', () => ({ execSafe: vi.fn() }));
vi.mock('../core/systemd', () => ({ restartService: vi.fn() }));

import { load, findApp } from '../core/registry';
import { execSafe } from '../core/exec';
import { restartService } from '../core/systemd';
import { rollbackCommand } from './rollback';
import { makeMcpContext } from '../registry/context';

const okExec = { ok: true, stdout: 'registry.example/web:latest\n', stderr: '', exitCode: 0 };
const failExec = { ok: false, stdout: '', stderr: 'err', exitCode: 1 };

beforeEach(() => vi.clearAllMocks());

describe('rollback CommandDef', () => {
  it('is a destructive registry command', () => {
    expect(rollbackCommand.name).toBe('rollback');
    expect(rollbackCommand.destructive).toBeTruthy();
  });

  it('returns an expected failure for an unknown app', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue(undefined);
    const result = await rollbackCommand.run({ app: 'nope', yes: true }, makeMcpContext(true));
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
  });

  it('fails fast when no previous image exists, without prompting', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web', composePath: '/srv/web', composeFile: null } as never);
    // resolveImageName's `docker compose config --images` succeeds; `docker image inspect` fails.
    vi.mocked(execSafe).mockImplementation((_cmd, a) =>
      (a.includes('inspect') ? failExec : okExec) as never);
    const result = await rollbackCommand.run({ app: 'web', yes: false }, makeMcpContext(false));
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/no previous image/i);
  });

  it('aborts when confirmation is denied', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web', composePath: '/srv/web', composeFile: null } as never);
    vi.mocked(execSafe).mockReturnValue(okExec as never); // config + inspect both ok
    const result = await rollbackCommand.run({ app: 'web', yes: false }, makeMcpContext(false));
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/cancel/i);
    // docker tag must NOT have run
    expect(vi.mocked(execSafe).mock.calls.some(c => c[1].includes('tag'))).toBeFalsy();
  });

  it('rolls back and restarts on success', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web', composePath: '/srv/web', composeFile: null } as never);
    vi.mocked(execSafe).mockReturnValue(okExec as never);
    vi.mocked(restartService).mockReturnValue(true);
    const result = await rollbackCommand.run({ app: 'web', yes: true }, makeMcpContext(true));
    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/rolled back/i);
    expect(vi.mocked(restartService)).toHaveBeenCalledWith('fleet-web');
    // the previous tag is re-applied over the latest tag.
    expect(vi.mocked(execSafe)).toHaveBeenCalledWith(
      'docker',
      ['tag', 'registry.example/web:fleet-previous', 'registry.example/web:latest'],
      expect.anything(),
    );
  });

  it('splits the image base at the tag colon, not a registry port colon', async () => {
    // `docker compose config --images` reports a registry-with-port image.
    const portImage = { ok: true, stdout: 'registry.example:5000/web:latest\n', stderr: '', exitCode: 0 };
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web', composePath: '/srv/web', composeFile: null } as never);
    vi.mocked(execSafe).mockImplementation((_cmd, a) =>
      (a.includes('config') ? portImage : okExec) as never);
    vi.mocked(restartService).mockReturnValue(true);
    const result = await rollbackCommand.run({ app: 'web', yes: true }, makeMcpContext(true));
    expect(result.ok).toBeTruthy();
    // :fleet-previous must replace the :latest tag, leaving the :5000 port intact.
    expect(vi.mocked(execSafe)).toHaveBeenCalledWith(
      'docker',
      ['tag', 'registry.example:5000/web:fleet-previous', 'registry.example:5000/web:latest'],
      expect.anything(),
    );
  });
});
