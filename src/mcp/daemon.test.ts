import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveGuardGid, securePermissions, startMcpDaemon } from './daemon';
import { socketPath } from './socket-path';
import * as exec from '../core/exec';

vi.mock('../core/exec');
const mockedExec = vi.mocked(exec.execSafe);

beforeEach(() => {
  mockedExec.mockReset();
  delete process.env.FLEET_MCP_SOCKET;
});

describe('startMcpDaemon', () => {
  it('refuses to run as a non-root user', async () => {
    // the test runner is not root, so this exercises the real guard.
    expect(process.getuid?.()).not.toBe(0);
    await expect(startMcpDaemon()).rejects.toThrow(/must run as root/);
  });
});

describe('resolveGuardGid', () => {
  it('parses the gid from getent output', () => {
    mockedExec.mockReturnValue({ ok: true, stdout: 'fleet-guard:!:985:matt', stderr: '', exitCode: 0 });
    expect(resolveGuardGid()).toBe(985);
  });

  it('returns null when the group does not exist', () => {
    mockedExec.mockReturnValue({ ok: false, stdout: '', stderr: '', exitCode: 2 });
    expect(resolveGuardGid()).toBeNull();
  });
});

describe('securePermissions', () => {
  it('locks the socket to root:gid 0660 and the dir to 0750', () => {
    const chown = vi.fn();
    const chmod = vi.fn();
    securePermissions('/run/fleet-mcp/mcp.sock', 985, { chown, chmod });
    expect(chown).toHaveBeenCalledWith('/run/fleet-mcp', 0, 985);
    expect(chmod).toHaveBeenCalledWith('/run/fleet-mcp', 0o750);
    expect(chown).toHaveBeenCalledWith('/run/fleet-mcp/mcp.sock', 0, 985);
    expect(chmod).toHaveBeenCalledWith('/run/fleet-mcp/mcp.sock', 0o660);
  });

  it('still tightens the socket mode when the group is unknown', () => {
    const chown = vi.fn();
    const chmod = vi.fn();
    securePermissions('/tmp/x.sock', null, { chown, chmod });
    expect(chown).not.toHaveBeenCalled();
    expect(chmod).toHaveBeenCalledWith('/tmp/x.sock', 0o660);
  });
});

describe('socketPath', () => {
  it('honours the FLEET_MCP_SOCKET override', () => {
    process.env.FLEET_MCP_SOCKET = '/tmp/custom.sock';
    expect(socketPath()).toBe('/tmp/custom.sock');
  });
});
