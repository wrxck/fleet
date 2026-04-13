import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  c: { bold: '', reset: '' },
  heading: vi.fn(),
  table: vi.fn(),
}));

import { load } from '../core/registry.js';
import { heading, table } from '../ui/output.js';
import { listCommand } from './list.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('listCommand', () => {
  const apps = [
    { name: 'app1', serviceName: 'fleet-app1', port: 3000, type: 'proxy', domains: ['app1.example.com'] },
    { name: 'app2', serviceName: 'fleet-app2', port: null, type: 'service', domains: [] },
  ];

  it('displays a table of registered apps', () => {
    vi.mocked(load).mockReturnValue({ apps } as any);
    listCommand([]);
    expect(heading).toHaveBeenCalled();
    expect(table).toHaveBeenCalled();
  });

  it('outputs JSON when --json flag is passed', () => {
    vi.mocked(load).mockReturnValue({ apps } as any);
    listCommand(['--json']);
    const output = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('app1');
  });

  it('handles empty registry', () => {
    vi.mocked(load).mockReturnValue({ apps: [] } as any);
    listCommand([]);
    expect(table).toHaveBeenCalledWith(expect.any(Array), []);
  });
});
