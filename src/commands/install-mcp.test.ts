import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() };
});

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { success, info } from '../ui/output.js';
import { installMcpCommand } from './install-mcp.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HOME = '/home/testuser';
});

describe('installMcpCommand', () => {
  it('installs MCP server config when not present', async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).includes('.claude.json')) return false;
      return true;
    });

    await installMcpCommand([]);

    expect(writeFileSync).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Installed'));
  });

  it('updates existing MCP server config', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { fleet: { command: 'old', args: [] } },
    }));

    await installMcpCommand([]);

    expect(writeFileSync).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Updated'));
  });

  it('uninstalls MCP server config', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { fleet: { command: 'node', args: [] } },
    }));

    await installMcpCommand(['--uninstall']);

    expect(writeFileSync).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Removed'));
  });

  it('handles uninstall when not configured', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{}');

    await installMcpCommand(['--uninstall']);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('not configured'));
  });
});
