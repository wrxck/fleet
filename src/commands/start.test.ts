import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry');
  return { ...actual, load: vi.fn(), findApp: vi.fn() };
});
vi.mock('../core/systemd', () => ({ startService: vi.fn() }));

import { load, findApp } from '../core/registry';
import { startService } from '../core/systemd';
import { startCommand } from './start';
import { makeCliContext } from '../registry/context';

beforeEach(() => vi.clearAllMocks());

describe('start CommandDef', () => {
  it('has registry metadata', () => {
    expect(startCommand.name).toBe('start');
  });

  it('starts a resolved app', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web' } as never);
    vi.mocked(startService).mockReturnValue(true);
    const result = await startCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(vi.mocked(startService)).toHaveBeenCalledWith('fleet-web');
    expect(result.summary).toMatch(/web/);
  });

  it('returns an expected failure for an unknown app', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue(undefined);
    const result = await startCommand.run({ app: 'nope' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
    expect(vi.mocked(startService)).not.toHaveBeenCalled();
  });

  it('returns an expected failure when the service op fails', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', serviceName: 'fleet-web' } as never);
    vi.mocked(startService).mockReturnValue(false);
    const result = await startCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/failed/i);
  });
});
