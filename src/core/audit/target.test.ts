import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({ existsSync: vi.fn(), statSync: vi.fn() }));
vi.mock('../registry.js', () => ({ load: vi.fn(), findApp: vi.fn() }));

import { existsSync, statSync } from 'node:fs';
import { load, findApp } from '../registry';
import { resolveAuditTarget } from './target';

const mockExists = vi.mocked(existsSync);
const mockStat = vi.mocked(statSync);
const mockLoad = vi.mocked(load);
const mockFindApp = vi.mocked(findApp);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue({ apps: [] } as unknown as ReturnType<typeof load>);
});

describe('resolveAuditTarget', () => {
  it('uses an existing directory path as-is', () => {
    mockExists.mockReturnValue(true);
    mockStat.mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    expect(resolveAuditTarget('/tmp/proj').projectPath).toBe('/tmp/proj');
  });

  it('resolves a registered app to its mobile subdir when present', () => {
    mockExists.mockImplementation((p) => p === '/srv/app/mobile');
    mockFindApp.mockReturnValue(
      { name: 'myapp', composePath: '/srv/app' } as ReturnType<typeof findApp>,
    );
    expect(resolveAuditTarget('myapp')).toEqual({
      target: 'myapp',
      projectPath: '/srv/app/mobile',
    });
  });

  it('falls back to the compose root when there is no mobile subdir', () => {
    mockExists.mockReturnValue(false);
    mockFindApp.mockReturnValue(
      { name: 'myapp', composePath: '/srv/app' } as ReturnType<typeof findApp>,
    );
    expect(resolveAuditTarget('myapp').projectPath).toBe('/srv/app');
  });

  it('throws for a target that is neither a directory nor a registered app', () => {
    mockExists.mockReturnValue(false);
    mockFindApp.mockReturnValue(undefined);
    expect(() => resolveAuditTarget('ghost')).toThrow(
      /neither an existing directory nor a registered app/,
    );
  });
});
