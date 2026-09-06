import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: vi.fn() };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn(),
}));

vi.mock('../core/health.js', () => ({
  checkAllHealth: vi.fn(),
  checkHealth: vi.fn(),
}));

vi.mock('../core/systemd.js', () => ({
  getServiceStatus: vi.fn(),
  restartServiceResult: vi.fn(),
}));

vi.mock('../core/notify.js', () => ({
  loadNotifyConfig: vi.fn(),
  sendNotification: vi.fn(),
}));

// the real watchdog policy runs; only its persistence is stubbed
vi.mock('../core/fs-json.js', () => ({
  readJson: vi.fn(),
  writeJsonAtomic: vi.fn(),
}));

vi.mock('../ui/output.js', () => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { readFileSync } from 'node:fs';

import { load } from '../core/registry';
import { checkAllHealth, checkHealth, type HealthResult } from '../core/health';
import { getServiceStatus, restartServiceResult } from '../core/systemd';
import { loadNotifyConfig, sendNotification } from '../core/notify';
import { readJson, writeJsonAtomic } from '../core/fs-json';
import { success, warn } from '../ui/output';
import { watchdogCommand } from './watchdog';
import type { AppEntry } from '../core/registry';

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'macpool',
    displayName: 'MacPool',
    composePath: '/home/matt/macpool',
    composeFile: null,
    serviceName: 'macpool',
    domains: [],
    port: 3549,
    usesSharedDb: false,
    type: 'nextjs',
    containers: ['macpool'],
    dependsOnDatabases: false,
    registeredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AppEntry;
}

function makeRegistry(apps: AppEntry[]) {
  return {
    version: 1,
    apps,
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '/srv/db' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

function makeResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    app: 'macpool',
    systemd: { ok: false, state: 'failed' },
    containers: [{ name: 'macpool', running: false, health: 'not found' }],
    http: null,
    overall: 'down',
    ...overrides,
  } as HealthResult;
}

const HEALTHY = makeResult({
  systemd: { ok: true, state: 'active' },
  containers: [{ name: 'macpool', running: true, health: 'healthy' }],
  overall: 'healthy',
});

function dbActive(active: boolean) {
  vi.mocked(getServiceStatus).mockReturnValue({
    name: 'docker-databases',
    active,
    enabled: true,
    state: active ? 'active' : 'inactive',
    description: '',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  vi.mocked(readFileSync).mockReturnValue('test-host');
  vi.mocked(readJson).mockReturnValue(null);
  vi.mocked(loadNotifyConfig).mockReturnValue({ adapters: [] } as never);
  vi.mocked(sendNotification).mockResolvedValue(true);
  vi.mocked(restartServiceResult).mockReturnValue({ ok: true });
  dbActive(true);
});

describe('watchdogCommand — healthy', () => {
  it('reports all healthy and sends nothing', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([]);

    await watchdogCommand([]);

    expect(success).toHaveBeenCalledWith(expect.stringContaining('healthy'));
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('watchdogCommand — remediation', () => {
  it('restarts a failed app and reports the recovery', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(checkHealth).mockReturnValue(HEALTHY);

    await watchdogCommand([]);

    expect(restartServiceResult).toHaveBeenCalledWith('macpool');
    const message = vi.mocked(sendNotification).mock.calls[0][1];
    expect(message).toContain('recovered');
    expect(message).toContain('- macpool (attempt 1): restarted');
  });

  it('keeps the app in the alert when the restart does not fix it', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(checkHealth).mockReturnValue(makeResult());

    await watchdogCommand([]);

    const message = vi.mocked(sendNotification).mock.calls[0][1];
    expect(message).toContain('DOWN');
    expect(message).toContain('- macpool: no running container (systemd: failed)');
  });

  it('reports a restart that could not be issued', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(restartServiceResult).mockReturnValue({ ok: false, error: 'permission denied' });

    await watchdogCommand([]);

    expect(checkHealth).not.toHaveBeenCalled();
    const message = vi.mocked(sendNotification).mock.calls[0][1];
    expect(message).toContain('failed — permission denied');
  });

  it('never restarts a degraded app that is still serving', async () => {
    const degraded = makeResult({
      systemd: { ok: false, state: 'failed' },
      containers: [{ name: 'macpool', running: true, health: 'healthy' }],
      http: { ok: false, status: 500, error: null },
      overall: 'degraded',
    });
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([degraded]);

    await watchdogCommand([]);

    expect(restartServiceResult).not.toHaveBeenCalled();
  });

  it('honours --no-remediate', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);

    await watchdogCommand(['--no-remediate']);

    expect(restartServiceResult).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalled();
  });

  it('stops restarting once the hourly budget is spent', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(readJson).mockReturnValue({
      lastSignature: '',
      lastAlertAt: null,
      restarts: { macpool: [new Date().toISOString(), new Date().toISOString()] },
    });

    await watchdogCommand([]);

    expect(restartServiceResult).not.toHaveBeenCalled();
  });
});

describe('watchdogCommand — alert suppression', () => {
  it('stays quiet when the failure set has not changed', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(readJson).mockReturnValue({
      lastSignature: 'down:macpool',
      lastAlertAt: new Date().toISOString(),
      restarts: { macpool: [new Date().toISOString(), new Date().toISOString()] },
    });

    await watchdogCommand([]);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(writeJsonAtomic).toHaveBeenCalled();
  });

  it('sends again when the failure set changes', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(readJson).mockReturnValue({
      lastSignature: 'down:something-else',
      lastAlertAt: new Date().toISOString(),
      restarts: { macpool: [new Date().toISOString(), new Date().toISOString()] },
    });

    await watchdogCommand([]);

    expect(sendNotification).toHaveBeenCalled();
  });

  it('does not advance the fingerprint when the send fails', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(readJson).mockReturnValue({
      lastSignature: '',
      lastAlertAt: null,
      restarts: { macpool: [new Date().toISOString(), new Date().toISOString()] },
    });
    vi.mocked(sendNotification).mockResolvedValue(false);

    await expect(watchdogCommand([])).rejects.toThrow('exit');

    const saved = vi.mocked(writeJsonAtomic).mock.calls.at(-1)?.[1] as { lastSignature: string };
    expect(saved.lastSignature).toBe('');
  });

  it('exits non-zero only when the alert cannot be sent', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(readJson).mockReturnValue({
      lastSignature: '',
      lastAlertAt: null,
      restarts: { macpool: [new Date().toISOString(), new Date().toISOString()] },
    });

    // a healthy send must not fail the unit — an unhealthy app is not a
    // watchdog failure, and a failed unit here hides real unit failures
    await expect(watchdogCommand([])).resolves.toBeUndefined();
  });

  it('exits non-zero when there is no notify config', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(loadNotifyConfig).mockReturnValue(null);

    await expect(watchdogCommand([])).rejects.toThrow('exit');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('notify config'));
  });
});

describe('watchdogCommand — motd', () => {
  it('displays failures but never restarts, alerts or writes state', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);

    await watchdogCommand(['--motd']);

    expect(warn).toHaveBeenCalled();
    expect(restartServiceResult).not.toHaveBeenCalled();
    expect(loadNotifyConfig).not.toHaveBeenCalled();
    expect(writeJsonAtomic).not.toHaveBeenCalled();
  });
});

describe('watchdogCommand — state write failure', () => {
  it('warns instead of crashing when the state file cannot be written', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([]);
    vi.mocked(readJson).mockReturnValue({ lastSignature: 'down:x', lastAlertAt: null, restarts: {} });
    vi.mocked(writeJsonAtomic).mockImplementation(() => { throw new Error('EACCES'); });

    await expect(watchdogCommand([])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not write watchdog state'));
  });

  it('restarts nothing when the attempt cannot be recorded', async () => {
    // the budget lives only in that file. restarting without it means one
    // restart per app per run, for ever — a loop, not a rate limit.
    vi.mocked(load).mockReturnValue(makeRegistry([makeApp()]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult()]);
    vi.mocked(writeJsonAtomic).mockImplementation(() => { throw new Error('ENOSPC'); });

    await watchdogCommand([]);

    expect(restartServiceResult).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('remediation stopped'));
  });
});

describe('watchdogCommand — databases listed as an app', () => {
  it('does not restart the databases even when a stale registry lists them under apps', async () => {
    const dbApp = makeApp({
      name: 'docker-databases',
      serviceName: 'docker-databases',
      containers: ['shared-postgres'],
    });
    vi.mocked(load).mockReturnValue(makeRegistry([dbApp]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([
      makeResult({
        app: 'docker-databases',
        containers: [{ name: 'shared-postgres', running: false, health: 'not found' }],
      }),
    ]);
    dbActive(false);

    await watchdogCommand([]);

    expect(restartServiceResult).not.toHaveBeenCalled();
  });

  it('lists the databases once, not twice', async () => {
    const dbApp = makeApp({ name: 'docker-databases', serviceName: 'docker-databases' });
    vi.mocked(load).mockReturnValue(makeRegistry([dbApp]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([makeResult({ app: 'docker-databases' })]);
    dbActive(false);

    await watchdogCommand([]);

    const message = vi.mocked(sendNotification).mock.calls[0][1] as string;
    expect(message.match(/docker-databases/g)).toHaveLength(1);
  });
});

describe('watchdogCommand — force alert', () => {
  it('sends a healthy report on a quiet box, so notify can be tested', async () => {
    vi.mocked(load).mockReturnValue(makeRegistry([]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([]);

    await watchdogCommand(['--force-alert']);

    expect(sendNotification).toHaveBeenCalled();
    expect(vi.mocked(sendNotification).mock.calls[0][1]).toContain('all services healthy');
  });
});

describe('watchdogCommand — shared databases', () => {
  it('flags the databases service when its unit is not active', async () => {
    dbActive(false);
    vi.mocked(load).mockReturnValue(makeRegistry([]) as never);
    vi.mocked(checkAllHealth).mockReturnValue([]);

    await watchdogCommand([]);

    const message = vi.mocked(sendNotification).mock.calls[0][1];
    expect(message).toContain('docker-databases');
  });
});
