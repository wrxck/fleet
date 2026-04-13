import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core/secrets.js', () => ({
  isInitialized: vi.fn(),
  restoreVaultFile: vi.fn(),
}));

vi.mock('../core/secrets-ops.js', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  sealFromRuntime: vi.fn(),
  detectDrift: vi.fn(),
}));

import { isInitialized } from '../core/secrets.js';
import { setSecret, getSecret, detectDrift } from '../core/secrets-ops.js';
import { registerSecretsTools } from './secrets-tools.js';

beforeEach(() => vi.clearAllMocks());

describe('registerSecretsTools', () => {
  it('registers all secrets tools', () => {
    const server = { tool: vi.fn() };
    registerSecretsTools(server as any);

    const toolNames = server.tool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames).toContain('fleet_secrets_set');
    expect(toolNames).toContain('fleet_secrets_get');
    expect(toolNames).toContain('fleet_secrets_drift');
  });

  it('fleet_secrets_set calls setSecret', async () => {
    const server = { tool: vi.fn() };
    registerSecretsTools(server as any);

    const setCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_secrets_set');
    const handler = setCall[setCall.length - 1];

    vi.mocked(isInitialized).mockReturnValue(true);

    const result = await handler({ app: 'myapp', key: 'DB_URL', value: 'postgres://...' });
    expect(setSecret).toHaveBeenCalledWith('myapp', 'DB_URL', 'postgres://...');
    expect(result.content[0].text).toContain('Set DB_URL');
  });

  it('fleet_secrets_get returns secret value', async () => {
    const server = { tool: vi.fn() };
    registerSecretsTools(server as any);

    const getCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_secrets_get');
    const handler = getCall[getCall.length - 1];

    vi.mocked(isInitialized).mockReturnValue(true);
    vi.mocked(getSecret).mockReturnValue('secret-value');

    const result = await handler({ app: 'myapp', key: 'DB_URL' });
    expect(result.content[0].text).toBe('secret-value');
  });

  it('fleet_secrets_get returns not found for missing key', async () => {
    const server = { tool: vi.fn() };
    registerSecretsTools(server as any);

    const getCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_secrets_get');
    const handler = getCall[getCall.length - 1];

    vi.mocked(isInitialized).mockReturnValue(true);
    vi.mocked(getSecret).mockReturnValue(null);

    const result = await handler({ app: 'myapp', key: 'MISSING' });
    expect(result.content[0].text).toContain('not found');
  });

  it('fleet_secrets_set throws when vault not initialized', async () => {
    const server = { tool: vi.fn() };
    registerSecretsTools(server as any);

    const setCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_secrets_set');
    const handler = setCall[setCall.length - 1];

    vi.mocked(isInitialized).mockReturnValue(false);

    await expect(handler({ app: 'myapp', key: 'K', value: 'V' })).rejects.toThrow('not initialised');
  });

  it('fleet_secrets_drift returns drift report', async () => {
    const server = { tool: vi.fn() };
    registerSecretsTools(server as any);

    const driftCall = server.tool.mock.calls.find((c: any[]) => c[0] === 'fleet_secrets_drift');
    const handler = driftCall[driftCall.length - 1];

    vi.mocked(isInitialized).mockReturnValue(true);
    vi.mocked(detectDrift).mockReturnValue([
      { app: 'myapp', status: 'in-sync' },
    ] as any);

    const result = await handler({ app: undefined });
    expect(result.content[0].text).toContain('in-sync');
  });
});
