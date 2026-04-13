import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, writeFileSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  readServiceFile: vi.fn(),
}));

vi.mock('../core/exec.js', () => ({
  execSafe: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { writeFileSync } from 'node:fs';
import { load } from '../core/registry.js';
import { readServiceFile } from '../core/systemd.js';
import { execSafe } from '../core/exec.js';
import { success, warn, info } from '../ui/output.js';
import { patchSystemdCommand } from './patch-systemd.js';

beforeEach(() => vi.clearAllMocks());

describe('patchSystemdCommand', () => {
  const mockReg = {
    apps: [{ serviceName: 'fleet-app1' }],
    infrastructure: { databases: { serviceName: 'docker-databases' } },
  };

  it('patches services without StartLimitBurst', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(readServiceFile).mockReturnValue('[Unit]\nDescription=test\n[Service]\nType=oneshot\n[Install]');
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as any);

    patchSystemdCommand([]);

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(execSafe).toHaveBeenCalledWith('systemctl', ['daemon-reload']);
    expect(success).toHaveBeenCalled();
  });

  it('skips services that already have StartLimitBurst', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(readServiceFile).mockReturnValue('[Service]\nStartLimitBurst=5\nStartLimitIntervalSec=300');

    patchSystemdCommand([]);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No services needed'));
  });

  it('skips services with no service file', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(readServiceFile).mockReturnValue(null);

    patchSystemdCommand([]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no service file'));
  });
});
