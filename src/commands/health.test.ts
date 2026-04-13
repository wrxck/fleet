import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/health.js', () => ({
  checkHealth: vi.fn(),
  checkAllHealth: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: { green: '', red: '', yellow: '', dim: '', bold: '', reset: '' },
  icon: { ok: 'OK', err: 'ERR', warn: 'WARN' },
  heading: vi.fn(),
  table: vi.fn(),
}));

import { load, findApp } from '../core/registry.js';
import { checkHealth, checkAllHealth } from '../core/health.js';
import { healthCommand } from './health.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
});

describe('healthCommand', () => {
  it('checks all apps when no app name given', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(checkAllHealth).mockReturnValue([]);
    healthCommand([]);
    expect(checkAllHealth).toHaveBeenCalled();
  });

  it('checks a single app when name given', () => {
    const app = { name: 'myapp', serviceName: 'fleet-myapp' };
    vi.mocked(load).mockReturnValue({ apps: [app] } as any);
    vi.mocked(findApp).mockReturnValue(app as any);
    vi.mocked(checkHealth).mockReturnValue({
      app: 'myapp', overall: 'healthy',
      systemd: { ok: true, state: 'active' },
      containers: [], http: null,
    });

    healthCommand(['myapp']);
    expect(checkHealth).toHaveBeenCalledWith(app);
  });

  it('outputs JSON when --json flag with single app', () => {
    const app = { name: 'myapp', serviceName: 'fleet-myapp' };
    vi.mocked(load).mockReturnValue({ apps: [app] } as any);
    vi.mocked(findApp).mockReturnValue(app as any);
    vi.mocked(checkHealth).mockReturnValue({
      app: 'myapp', overall: 'healthy',
      systemd: { ok: true, state: 'active' },
      containers: [], http: null,
    });

    healthCommand(['myapp', '--json']);
    const output = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    expect(JSON.parse(output).overall).toBe('healthy');
  });

  it('outputs JSON when --json flag with all apps', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(checkAllHealth).mockReturnValue([]);
    healthCommand(['--json']);
    const output = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual([]);
  });

  it('throws for unknown app', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    vi.mocked(findApp).mockReturnValue(undefined as any);
    expect(() => healthCommand(['unknown'])).toThrow();
  });
});
