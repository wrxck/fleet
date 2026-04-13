import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
  findApp: vi.fn(),
}));

vi.mock('../core/deps/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('../core/deps/cache.js', () => ({
  loadCache: vi.fn(),
  saveCache: vi.fn(),
}));

vi.mock('../core/deps/scanner.js', () => ({
  runScan: vi.fn(),
}));

vi.mock('../core/deps/actors/pr-creator.js', () => ({
  createDepsPr: vi.fn(),
}));

import { load } from '../core/registry.js';
import { loadConfig } from '../core/deps/config.js';
import { loadCache, saveCache } from '../core/deps/cache.js';
import { runScan } from '../core/deps/scanner.js';
import { registerDepsTools } from './deps-tools.js';

beforeEach(() => vi.clearAllMocks());

describe('registerDepsTools', () => {
  it('registers tools on the server', () => {
    const server = { tool: vi.fn() };
    registerDepsTools(server as any);

    const toolNames = server.tool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames).toContain('fleet_deps_status');
    expect(toolNames).toContain('fleet_deps_scan');
  });

  it('fleet_deps_status returns cache data', async () => {
    const server = { tool: vi.fn() };
    registerDepsTools(server as any);

    const statusCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_deps_status');
    const handler = statusCall[statusCall.length - 1];

    vi.mocked(loadCache).mockReturnValue({ findings: [], errors: [], scanDurationMs: 100, scannedAt: '' } as any);
    const result = await handler();
    expect(result.content[0].text).toContain('findings');
  });

  it('fleet_deps_status returns message when no cache', async () => {
    const server = { tool: vi.fn() };
    registerDepsTools(server as any);

    const statusCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_deps_status');
    const handler = statusCall[statusCall.length - 1];

    vi.mocked(loadCache).mockReturnValue(null);
    const result = await handler();
    expect(result.content[0].text).toContain('No scan data');
  });

  it('fleet_deps_scan runs scan and saves cache', async () => {
    const server = { tool: vi.fn() };
    registerDepsTools(server as any);

    const scanCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_deps_scan');
    const handler = scanCall[scanCall.length - 1];

    vi.mocked(load).mockReturnValue({ apps: [{ name: 'app1' }] } as any);
    vi.mocked(loadConfig).mockReturnValue({ concurrency: 4, severityOverrides: {} } as any);
    vi.mocked(runScan).mockResolvedValue({ findings: [], errors: [], scanDurationMs: 50 } as any);

    const result = await handler();
    expect(saveCache).toHaveBeenCalled();
    expect(result.content[0].text).toContain('findings');
  });
});
