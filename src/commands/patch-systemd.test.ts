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
  unsealUnitExists: vi.fn(() => false),
  UNSEAL_SERVICE: 'fleet-unseal',
}));

vi.mock('../core/exec.js', () => ({
  execSafe: vi.fn(),
}));

import { writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';

import { load } from '../core/registry';
import { readServiceFile, unsealUnitExists } from '../core/systemd';
import { execSafe } from '../core/exec';
import { patchSystemdCommand } from './patch-systemd';
import { makeMcpContext } from '../registry/context';
import type { Registry } from '../core/registry';

beforeEach(() => vi.clearAllMocks());

// minimal typed registry fixture
function makeRegistry(overrides: Partial<{ appServiceNames: string[]; dbServiceName: string }> = {}): Registry {
  const appServiceNames = overrides.appServiceNames ?? ['fleet-app1'];
  const dbServiceName = overrides.dbServiceName ?? 'docker-databases';
  return {
    version: 1,
    apps: appServiceNames.map(serviceName => ({
      name: serviceName,
      displayName: serviceName,
      composePath: `/apps/${serviceName}`,
      composeFile: null,
      serviceName,
      domains: [],
      port: null,
      usesSharedDb: false,
      type: 'service' as const,
      containers: [serviceName],
      dependsOnDatabases: false,
      registeredAt: '2026-01-01T00:00:00.000Z',
    })),
    infrastructure: {
      databases: { serviceName: dbServiceName, composePath: '/srv/databases' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

const baseServiceContent = (name: string) =>
  `[Unit]\nDescription=${name}\n[Service]\nExecStart=/usr/bin/docker compose up -d\nTimeoutStartSec=300\n[Install]`;

describe('patchSystemdCommand — metadata', () => {
  it('has the correct name', () => {
    expect(patchSystemdCommand.name).toBe('patch-systemd');
  });

  it('is marked destructive', () => {
    expect(patchSystemdCommand.destructive).toBeTruthy();
  });
});

describe('patchSystemdCommand run() — confirm denied', () => {
  it('returns cancelled without patching when confirmation is denied', async () => {
    const result = await patchSystemdCommand.run(
      { rollback: false, yes: false },
      makeMcpContext(false),
    );

    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/cancel/i);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
  });
});

describe('patchSystemdCommand run() — patch happy path', () => {
  it('patches a service lacking StartLimitBurst and returns ok', async () => {
    const reg = makeRegistry();
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockReturnValue(
      '[Unit]\nDescription=app\n[Service]\nExecStart=/usr/bin/docker compose up\nTimeoutStartSec=300',
    );
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    const result = await patchSystemdCommand.run(
      { rollback: false, yes: true },
      makeMcpContext(false),
    );

    expect(result.ok).toBeTruthy();
    expect(writeFileSync).toHaveBeenCalled();
    expect(result.data).toMatchObject({ action: 'patch' });

    // the rewritten unit file must carry the new settings for an app service.
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('StartLimitBurst=5');
    expect(written).toContain('StartLimitIntervalSec=300');
    expect(written).toContain('ExecStart=/usr/bin/env fleet boot-start fleet-app1');
    expect(written).toContain('TimeoutStartSec=900');
    expect(written).not.toContain('TimeoutStartSec=300');
  });

  it('does not duplicate StartLimitBurst on a partially-patched service', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry());
    // already has StartLimitBurst but lacks the boot-start ExecStart.
    vi.mocked(readServiceFile).mockReturnValue(
      '[Unit]\nDescription=app\nStartLimitBurst=5\nStartLimitIntervalSec=300\n\n[Service]\nExecStart=/usr/bin/docker compose up\nTimeoutStartSec=300',
    );
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    const result = await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    expect(result.ok).toBeTruthy();
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    // StartLimitBurst already present — must appear exactly once, not be re-inserted.
    expect(written.match(/StartLimitBurst=/g)).toHaveLength(1);
    expect(written).toContain('ExecStart=/usr/bin/env fleet boot-start fleet-app1');
  });
});

describe('patchSystemdCommand run() — nothing to do', () => {
  it('returns ok with "no services needed" summary when all already patched', async () => {
    const reg = makeRegistry();
    vi.mocked(load).mockReturnValue(reg);
    // return fully-patched content for every service
    vi.mocked(readServiceFile).mockImplementation((name: string) =>
      `[Unit]\nDescription=${name}\nStartLimitIntervalSec=300\nStartLimitBurst=5\n\n[Service]\nExecStart=/usr/bin/env fleet boot-start ${name}\nTimeoutStartSec=900`,
    );

    const result = await patchSystemdCommand.run(
      { rollback: false, yes: true },
      makeMcpContext(false),
    );

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/no services needed/i);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe('patchSystemdCommand run() — rollback happy path', () => {
  it('restores from .bak files and calls daemon-reload', async () => {
    const reg = makeRegistry({ appServiceNames: ['fleet-app1'], dbServiceName: 'docker-databases' });
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(renameSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    const result = await patchSystemdCommand.run(
      { rollback: true, yes: true },
      makeMcpContext(false),
    );

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/restored/i);
    expect(renameSync).toHaveBeenCalled();
    expect(result.data).toMatchObject({ action: 'rollback' });
  });
});

describe('patchSystemdCommand run() — daemon-reload failure on patch', () => {
  it('returns ok:false when daemon-reload fails after patching', async () => {
    const reg = makeRegistry();
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockReturnValue(baseServiceContent('fleet-app1'));
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({
      ok: false,
      stdout: '',
      stderr: 'unit not found',
    } as never);

    const result = await patchSystemdCommand.run(
      { rollback: false, yes: true },
      makeMcpContext(false),
    );

    expect(result.ok).toBeFalsy();
    expect(result.summary).toMatch(/daemon-reload failed/i);
  });
});

describe('patchSystemdCommand run() — backup path', () => {
  it('copies the original file to .bak before overwriting', async () => {
    const reg = makeRegistry({ appServiceNames: ['fleet-app1'], dbServiceName: 'docker-databases' });
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    expect(copyFileSync).toHaveBeenCalledWith(
      '/etc/systemd/system/fleet-app1.service',
      '/etc/systemd/system/fleet-app1.service.bak',
    );
  });

  it('keeps an existing .bak so a second patch cannot overwrite the original', async () => {
    const reg = makeRegistry({ appServiceNames: ['fleet-app1'], dbServiceName: 'docker-databases' });
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    expect(copyFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
  });
});

describe('patchSystemdCommand run() — unseal dependency', () => {
  it('adds the unseal dependency to every unit when the unseal unit is installed', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry());
    vi.mocked(unsealUnitExists).mockReturnValue(true);
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('Requires=fleet-unseal.service');
    expect(written).toContain('After=fleet-unseal.service');
    vi.mocked(unsealUnitExists).mockReturnValue(false);
  });

  it('leaves the unseal dependency off when the unseal unit is absent', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry());
    vi.mocked(unsealUnitExists).mockReturnValue(false);
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).not.toContain('fleet-unseal.service');
  });
});

describe('patchSystemdCommand run() — databases dependency repair', () => {
  it('adds the databases dependency when the registry says the app needs it', async () => {
    const reg = makeRegistry();
    reg.apps[0].dependsOnDatabases = true;
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const appWrite = vi.mocked(writeFileSync).mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('fleet-app1.service'),
    );
    const written = appWrite![1] as string;
    expect(written).toContain('Requires=docker-databases.service');
    expect(written).toContain('After=docker-databases.service');
  });

  it('leaves the dependency off when the registry says the app does not need it', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry());
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const appWrite = vi.mocked(writeFileSync).mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('fleet-app1.service'),
    );
    expect(appWrite![1] as string).not.toContain('docker-databases.service');
  });

  it('does not add the dependency when the databases unit is not installed', async () => {
    // systemd refuses to start a unit that hard-depends on a missing target, so
    // a registry flag alone would take a working app down at the next boot.
    const reg = makeRegistry();
    reg.apps[0].dependsOnDatabases = true;
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockImplementation((name: string) =>
      name === 'docker-databases' ? null : baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const appWrite = vi.mocked(writeFileSync).mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('fleet-app1.service'),
    );
    expect(appWrite![1] as string).not.toContain('docker-databases.service');
  });

  it('never adds the databases service as its own dependency', async () => {
    const reg = makeRegistry({ appServiceNames: ['docker-databases'] });
    reg.apps[0].dependsOnDatabases = true;
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(readServiceFile).mockImplementation((name: string) => baseServiceContent(name));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).not.toContain('Requires=docker-databases.service');
  });
});

describe('patchSystemdCommand run() — teardown removal', () => {
  it('strips the ExecStartPre compose-down from an existing unit', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry());
    vi.mocked(readServiceFile).mockReturnValue(
      '[Unit]\nDescription=app\nStartLimitIntervalSec=300\nStartLimitBurst=5\n\n[Service]\nExecStartPre=-/usr/bin/docker compose down\nExecStart=/usr/bin/env fleet boot-start fleet-app1\nTimeoutStartSec=900\nExecStop=/usr/bin/docker compose down --timeout 30',
    );
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    const result = await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    expect(result.ok).toBeTruthy();
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).not.toContain('ExecStartPre=');
    // stopping the unit must still tear the stack down
    expect(written).toContain('ExecStop=/usr/bin/docker compose down --timeout 30');
  });
});

describe('patchSystemdCommand run() — databases service guard', () => {
  it('does not rewrite ExecStart on the databases service', async () => {
    const dbContent =
      '[Unit]\nDescription=docker databases\n[Service]\nExecStart=/usr/bin/docker compose -f /srv/db/docker-compose.yml up -d\nTimeoutStartSec=300\n[Install]';

    vi.mocked(load).mockReturnValue(
      makeRegistry({ appServiceNames: ['fleet-app1'], dbServiceName: 'docker-databases' }),
    );
    vi.mocked(readServiceFile).mockImplementation((name: string) => {
      if (name === 'docker-databases') return dbContent;
      return baseServiceContent(name);
    });
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    const dbWrite = vi.mocked(writeFileSync).mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('docker-databases.service'),
    );
    expect(dbWrite).toBeDefined();
    const written = dbWrite![1] as string;
    expect(written).toContain('StartLimitBurst=5');
    expect(written).not.toContain('fleet boot-start docker-databases');
  });
});

describe('patchSystemdCommand run() — rollback no .bak files', () => {
  it('returns ok:true with "no .bak files found" summary when nothing to restore', async () => {
    const reg = makeRegistry();
    vi.mocked(load).mockReturnValue(reg);
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await patchSystemdCommand.run(
      { rollback: true, yes: true },
      makeMcpContext(false),
    );

    expect(result.ok).toBeTruthy();
    expect(result.summary).toMatch(/no .bak files found/i);
    expect(renameSync).not.toHaveBeenCalled();
    expect(execSafe).not.toHaveBeenCalled();
  });
});
