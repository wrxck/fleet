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

import { writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';

import { load } from '../core/registry';
import { readServiceFile } from '../core/systemd';
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
  });
});

describe('patchSystemdCommand run() — nothing to do', () => {
  it('returns ok with "no services needed" summary when all already patched', async () => {
    const reg = makeRegistry();
    vi.mocked(load).mockReturnValue(reg);
    // return fully-patched content for every service
    vi.mocked(readServiceFile).mockImplementation((name: string) =>
      `[Service]\nExecStart=/usr/bin/env fleet boot-start ${name}\nTimeoutStartSec=900\nStartLimitBurst=5\nStartLimitIntervalSec=300`,
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
    vi.mocked(copyFileSync).mockImplementation(() => undefined);
    vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '' } as never);

    await patchSystemdCommand.run({ rollback: false, yes: true }, makeMcpContext(false));

    expect(copyFileSync).toHaveBeenCalledWith(
      '/etc/systemd/system/fleet-app1.service',
      '/etc/systemd/system/fleet-app1.service.bak',
    );
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
