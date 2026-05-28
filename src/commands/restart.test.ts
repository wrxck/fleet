import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry');
  return { ...actual, load: vi.fn(), findApp: vi.fn() };
});
vi.mock('../core/systemd', () => ({ restartService: vi.fn() }));

import { load, findApp } from '../core/registry';
import { restartService } from '../core/systemd';
import { restartCommand } from './restart';
import { makeCliContext } from '../registry/context';

beforeEach(() => vi.clearAllMocks());

describe('restart CommandDef', () => {
  it('has registry metadata', () => {
    expect(restartCommand.name).toBe('restart');
  });

  it('restarts a resolved app', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web' } as never);
    vi.mocked(restartService).mockReturnValue(true);
    const result = await restartCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(vi.mocked(restartService)).toHaveBeenCalledWith('fleet-web');
    expect(result.summary).toMatch(/web/);
  });

  it('returns an expected failure for an unknown app', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue(undefined);
    const result = await restartCommand.run({ app: 'nope' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
    expect(vi.mocked(restartService)).not.toHaveBeenCalled();
  });

  it('returns an expected failure when the service op fails', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web' } as never);
    vi.mocked(restartService).mockReturnValue(false);
    const result = await restartCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/failed/i);
  });
});
