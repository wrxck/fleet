import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry', async () => {
  const actual = await vi.importActual<typeof import('../core/registry')>('../core/registry');
  return { ...actual, load: vi.fn(), findApp: vi.fn() };
});
vi.mock('../core/health', () => ({ checkHealth: vi.fn(), checkAllHealth: vi.fn() }));

import { load, findApp } from '../core/registry';
import { checkHealth, checkAllHealth } from '../core/health';
import { healthCommand } from './health';
import { makeCliContext } from '../registry/context';
import type { HealthResult } from '../core/health';

/** minimal HealthResult stub — all fields render logic touches. */
function hr(app: string, overall: 'healthy' | 'degraded' | 'down'): HealthResult {
  return {
    app,
    overall,
    systemd: { ok: true, state: 'active' },
    containers: [],
    http: null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('health CommandDef', () => {
  it('has registry metadata with the health rich view', () => {
    expect(healthCommand.name).toBe('health');
    expect(healthCommand.tui).toEqual({ view: 'health' });
  });

  it('checks all apps when no app is given', async () => {
    vi.mocked(load).mockReturnValue({ apps: [{ name: 'web' }] } as never);
    vi.mocked(checkAllHealth).mockReturnValue([hr('web', 'healthy')] as never);
    const result = await healthCommand.run({}, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(result.render?.kind).toBe('table');
    expect(result.data).toHaveLength(1);
    expect(vi.mocked(checkAllHealth)).toHaveBeenCalled();
  });

  it('checks a single resolved app', async () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as never);
    vi.mocked(findApp).mockReturnValue({ name: 'web' } as never);
    vi.mocked(checkHealth).mockReturnValue(hr('web', 'degraded') as never);
    const result = await healthCommand.run({ app: 'web' }, makeCliContext());
    expect(result.ok).toBeTruthy();
    expect(result.data).toHaveLength(1);
    expect(vi.mocked(checkHealth)).toHaveBeenCalled();
  });

  it('returns an expected failure for an unknown app', async () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as never);
    vi.mocked(findApp).mockReturnValue(undefined);
    const result = await healthCommand.run({ app: 'nope' }, makeCliContext());
    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/not found/i);
  });

  it('builds a table render with correct columns', async () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as never);
    vi.mocked(checkAllHealth).mockReturnValue([
      hr('api', 'healthy'),
      hr('worker', 'down'),
    ] as never);
    const result = await healthCommand.run({}, makeCliContext());
    expect(result.render?.kind).toBe('table');
    if (result.render?.kind === 'table') {
      expect(result.render.columns).toEqual(['APP', 'SYSTEMD', 'CONTAINERS', 'HTTP', 'OVERALL']);
      expect(result.render.rows).toHaveLength(2);
    }
  });

  it('summary counts healthy/degraded/down correctly', async () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as never);
    vi.mocked(checkAllHealth).mockReturnValue([
      hr('a', 'healthy'),
      hr('b', 'degraded'),
      hr('c', 'down'),
    ] as never);
    const result = await healthCommand.run({}, makeCliContext());
    expect(result.summary).toMatch(/1 healthy/);
    expect(result.summary).toMatch(/1 degraded/);
    expect(result.summary).toMatch(/1 down/);
  });

  it('renders http status code when http.ok is true', async () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as never);
    const withHttp: HealthResult = {
      ...hr('web', 'healthy'),
      http: { ok: true, status: 200, error: null },
    };
    vi.mocked(checkAllHealth).mockReturnValue([withHttp] as never);
    const result = await healthCommand.run({}, makeCliContext());
    if (result.render?.kind === 'table') {
      // http column is index 3
      expect(result.render.rows[0][3]).toBe('200');
    }
  });
});
