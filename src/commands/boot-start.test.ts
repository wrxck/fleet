import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry');
  return { ...actual, load: vi.fn(), findApp: vi.fn() };
});
vi.mock('../core/boot-refresh', () => ({ refresh: vi.fn() }));
vi.mock('../core/docker', () => ({ composeUp: vi.fn() }));

import { load, findApp } from '../core/registry';
import { refresh } from '../core/boot-refresh';
import { composeUp } from '../core/docker';
import { bootStartCommand } from './boot-start';
import { makeCliContext } from '../registry/context';

beforeEach(() => vi.clearAllMocks());

describe('boot-start CommandDef', () => {
  it('has the correct registry metadata', () => {
    expect(bootStartCommand.name).toBe('boot-start');
    expect(bootStartCommand.cliOnly).toBeTruthy();
  });

  it('returns ok: false when app is not found in registry', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue(undefined);
    const result = await bootStartCommand.run({ app: 'ghost' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
    expect(vi.mocked(composeUp)).not.toHaveBeenCalled();
  });

  it('returns ok: true when refresh returns no-change and composeUp succeeds', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', composePath: '/srv/web', composeFile: null } as never);
    vi.mocked(refresh).mockResolvedValue({ kind: 'no-change', head: 'abc' } as never);
    vi.mocked(composeUp).mockReturnValue(true);
    const result = await bootStartCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/up/i);
  });

  it('returns ok: false when composeUp fails (refresh ok)', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', composePath: '/srv/web', composeFile: null } as never);
    vi.mocked(refresh).mockResolvedValue({ kind: 'no-change', head: 'abc' } as never);
    vi.mocked(composeUp).mockReturnValue(false);
    const result = await bootStartCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/compose up failed/i);
  });

  it('still runs composeUp and returns ok: true when refresh rejects (fail-safe)', async () => {
    vi.mocked(load).mockReturnValue({} as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web', composePath: '/srv/web', composeFile: null } as never);
    vi.mocked(refresh).mockRejectedValue(new Error('boom') as never);
    vi.mocked(composeUp).mockReturnValue(true);
    const result = await bootStartCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(vi.mocked(composeUp)).toHaveBeenCalled();
  });
});
