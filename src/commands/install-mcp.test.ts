import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { installMcpCommand } from './install-mcp';
import { makeCliContext } from '../registry/context';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOME = '/home/testuser';
});

describe('install-mcp CommandDef', () => {
  it('has the correct registry metadata', () => {
    expect(installMcpCommand.name).toBe('install-mcp');
    expect(installMcpCommand.cliOnly).toBeTruthy();
  });

  it('installs MCP server config when not present', async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).includes('.claude.json')) return false;
      return true;
    });
    vi.mocked(readFileSync).mockReturnValue('{}');

    const result = await installMcpCommand.run({ uninstall: false }, makeCliContext());

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/install/i);
    expect(result.data).toEqual({ installed: true });
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('updates existing MCP server config', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { fleet: { command: 'old', args: [] } },
    }));

    const result = await installMcpCommand.run({ uninstall: false }, makeCliContext());

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/updat/i);
    expect(result.data).toEqual({ installed: true });
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('uninstalls MCP server config', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { fleet: { command: 'node', args: [] } },
    }));

    const result = await installMcpCommand.run({ uninstall: true }, makeCliContext());

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/remov/i);
    expect(result.data).toEqual({ installed: false });
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('handles uninstall when not configured', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    const result = await installMcpCommand.run({ uninstall: true }, makeCliContext());

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/not configured|nothing to remov/i);
    expect(result.data).toEqual({ installed: false });
  });
});
