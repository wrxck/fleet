import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    existsSync: vi.fn(),
    renameSync: vi.fn(),
  };
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
  error: vi.fn(),
}));

import { writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';
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
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as any);

    patchSystemdCommand([]);

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(execSafe).toHaveBeenCalledWith('systemctl', ['daemon-reload']);
    expect(success).toHaveBeenCalled();
  });

  it('skips services that already have StartLimitBurst', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    // Return fully-patched content per service name so idempotency applies to all
    vi.mocked(readServiceFile).mockImplementation(
      (name: string) =>
        `[Service]\nExecStart=/usr/bin/env fleet boot-start ${name}\nTimeoutStartSec=900\nStartLimitBurst=5\nStartLimitIntervalSec=300`,
    );

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

describe('patchSystemdCommand — ExecStart rewrite + backup', () => {
  const mockReg = {
    apps: [{ serviceName: 'fleet-app1' }, { serviceName: 'fleet-app2' }],
    infrastructure: { databases: { serviceName: 'docker-databases' } },
  };

  const oldContent = (name: string) =>
    `[Unit]\nDescription=${name}\n[Service]\nExecStart=/usr/bin/docker compose up -d --force-recreate\nTimeoutStartSec=300\n[Install]`;

  it('(a) rewrites ExecStart, bumps TimeoutStartSec, backs up original', () => {
    vi.mocked(load).mockReturnValue({
      apps: [{ serviceName: 'fleet-app1' }],
      infrastructure: { databases: { serviceName: 'docker-databases' } },
    } as any);
    vi.mocked(readServiceFile).mockReturnValue(oldContent('fleet-app1'));
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as any);

    patchSystemdCommand([]);

    // Backup created before write
    expect(copyFileSync).toHaveBeenCalledWith(
      '/etc/systemd/system/fleet-app1.service',
      '/etc/systemd/system/fleet-app1.service.bak',
    );

    // Written content has new ExecStart and TimeoutStartSec=900
    const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(writtenContent).toContain('ExecStart=/usr/bin/env fleet boot-start fleet-app1');
    expect(writtenContent).toContain('TimeoutStartSec=900');
    expect(writtenContent).not.toContain('TimeoutStartSec=300');
  });

  it('(b) idempotent: already fully patched — no writes, no backup', () => {
    vi.mocked(load).mockReturnValue({
      apps: [{ serviceName: 'fleet-app1' }],
      infrastructure: { databases: { serviceName: 'docker-databases' } },
    } as any);
    vi.mocked(readServiceFile).mockImplementation(
      (name: string) =>
        `[Service]\nExecStart=/usr/bin/env fleet boot-start ${name}\nTimeoutStartSec=900\nStartLimitBurst=5\nStartLimitIntervalSec=300`,
    );

    patchSystemdCommand([]);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(copyFileSync).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No services needed'));
  });

  it('(c) partial state: has StartLimitBurst but not boot-start — still patches ExecStart + TimeoutStartSec, backs up', () => {
    const partial = `[Service]\nExecStart=/usr/bin/docker compose up -d\nTimeoutStartSec=60\nStartLimitBurst=5\nStartLimitIntervalSec=300`;

    vi.mocked(load).mockReturnValue({
      apps: [{ serviceName: 'fleet-app1' }],
      infrastructure: { databases: { serviceName: 'docker-databases' } },
    } as any);
    vi.mocked(readServiceFile).mockReturnValue(partial);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as any);

    patchSystemdCommand([]);

    expect(copyFileSync).toHaveBeenCalledWith(
      '/etc/systemd/system/fleet-app1.service',
      '/etc/systemd/system/fleet-app1.service.bak',
    );

    const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(writtenContent).toContain('ExecStart=/usr/bin/env fleet boot-start fleet-app1');
    expect(writtenContent).toContain('TimeoutStartSec=900');
    // StartLimitBurst not duplicated
    expect((writtenContent.match(/StartLimitBurst=/g) ?? []).length).toBe(1);
  });

  it('(d) --rollback restores .bak files for all services and runs daemon-reload', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(renameSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as any);

    patchSystemdCommand(['--rollback']);

    // Should restore all 3 services (fleet-app1, fleet-app2, docker-databases)
    expect(renameSync).toHaveBeenCalledTimes(3);
    expect(renameSync).toHaveBeenCalledWith(
      '/etc/systemd/system/fleet-app1.service.bak',
      '/etc/systemd/system/fleet-app1.service',
    );
    expect(renameSync).toHaveBeenCalledWith(
      '/etc/systemd/system/fleet-app2.service.bak',
      '/etc/systemd/system/fleet-app2.service',
    );
    expect(renameSync).toHaveBeenCalledWith(
      '/etc/systemd/system/docker-databases.service.bak',
      '/etc/systemd/system/docker-databases.service',
    );
    expect(execSafe).toHaveBeenCalledWith('systemctl', ['daemon-reload']);
  });

  it('(e) --rollback when no .bak files exist — no renames, logs message, no daemon-reload', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(existsSync).mockReturnValue(false);

    patchSystemdCommand(['--rollback']);

    expect(renameSync).not.toHaveBeenCalled();
    expect(execSafe).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No .bak files found'));
  });
});

describe('patchSystemdCommand — databases service is not boot-start-ified', () => {
  const dbServiceFile =
    '[Unit]\nDescription=docker databases\n[Service]\nExecStart=/usr/bin/docker compose -f /srv/docker-databases/docker-compose.yml up -d --force-recreate\nTimeoutStartSec=300\n[Install]';

  const mockReg = {
    apps: [{ serviceName: 'fleet-app1' }],
    infrastructure: { databases: { serviceName: 'docker-databases' } },
  };

  it('does not rewrite ExecStart on docker-databases.service', () => {
    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(readServiceFile).mockImplementation((name: string) => {
      if (name === 'docker-databases') return dbServiceFile;
      // app service: also needs patching so the command does something and calls daemon-reload
      return '[Unit]\nDescription=app\n[Service]\nExecStart=/usr/bin/docker compose up -d\nTimeoutStartSec=300\n[Install]';
    });
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as any);

    patchSystemdCommand([]);

    // Find the write call for docker-databases (if any)
    const dbWrite = vi.mocked(writeFileSync).mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('docker-databases.service'),
    );

    // (a) if written: must contain StartLimitBurst
    if (dbWrite) {
      const written = dbWrite[1] as string;
      expect(written).toContain('StartLimitBurst=5');
      // (b) must NOT rewrite ExecStart to fleet boot-start
      expect(written).not.toContain('fleet boot-start docker-databases');
      // (c) must preserve the original docker compose ExecStart
      expect(written).toContain('ExecStart=/usr/bin/docker compose');
      // (d) must NOT change TimeoutStartSec to 900 for docker-databases
      expect(written).not.toContain('TimeoutStartSec=900');
    } else {
      // If no write at all, that means it was skipped — that only happens if already fully patched,
      // which this fixture is not (no StartLimitBurst). This branch should not be reached.
      // Fail explicitly if we get here.
      expect(dbWrite).toBeDefined();
    }
  });

  it('regression: dedupes when docker-databases is in both reg.apps and infrastructure', () => {
    // simulates a registry where docker-databases was added to apps (e.g. via
    // an earlier `fleet add` or migration). without dedupe the apps entry would
    // win and rewrite ExecStart on the shared databases service.
    vi.mocked(load).mockReturnValue({
      apps: [{ serviceName: 'fleet-app1' }, { serviceName: 'docker-databases' }],
      infrastructure: { databases: { serviceName: 'docker-databases' } },
    } as ReturnType<typeof load>);
    vi.mocked(readServiceFile).mockImplementation((name: string) => {
      if (name === 'docker-databases') return dbServiceFile;
      return '[Unit]\nDescription=app\n[Service]\nExecStart=/usr/bin/docker compose up -d\nTimeoutStartSec=300\n[Install]';
    });
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as ReturnType<typeof execSafe>);

    patchSystemdCommand([]);

    const dbWrite = vi.mocked(writeFileSync).mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('docker-databases.service'),
    );
    expect(dbWrite).toBeDefined();
    const written = dbWrite![1] as string;
    expect(written).not.toContain('fleet boot-start docker-databases');
    expect(written).toContain('ExecStart=/usr/bin/docker compose');
  });

  it('does not create docker-databases.service.bak if the only change would be boot-start/timeout', () => {
    // Provide a databases service that already has StartLimitBurst — so with the fix,
    // no changes are needed and no write/backup should happen.
    const alreadyPatched =
      '[Service]\nExecStart=/usr/bin/docker compose -f /srv/docker-databases/docker-compose.yml up -d --force-recreate\nStartLimitBurst=5\nStartLimitIntervalSec=300';

    vi.mocked(load).mockReturnValue(mockReg as any);
    vi.mocked(readServiceFile).mockImplementation((name: string) => {
      if (name === 'docker-databases') return alreadyPatched;
      // app service: also already patched so we get a clean no-op
      return `[Service]\nExecStart=/usr/bin/env fleet boot-start ${name}\nTimeoutStartSec=900\nStartLimitBurst=5\nStartLimitIntervalSec=300`;
    });

    patchSystemdCommand([]);

    // No backup created for docker-databases
    expect(copyFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('docker-databases.service'),
      expect.stringContaining('docker-databases.service.bak'),
    );
    // No write for docker-databases
    const dbWrite = vi.mocked(writeFileSync).mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('docker-databases'),
    );
    expect(dbWrite).toBeUndefined();
  });
});
