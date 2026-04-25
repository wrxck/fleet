import { execSafe } from './exec.js';
import { assertHealthPath } from './validate.js';
import { getServiceStatus, getMultipleServiceStatuses, systemdAvailable, type ServiceStatus } from './systemd.js';
import { listContainers, type ContainerInfo } from './docker.js';
import type { AppEntry } from './registry.js';

export interface HealthResult {
  app: string;
  systemd: { ok: boolean; state: string };
  containers: ContainerHealth[];
  http: {
    ok: boolean;
    status: number | null;
    error: string | null;
    /** True iff the endpoint returned 404 — distinguishes "no healthcheck
     * implemented for this app" from "endpoint exists but is failing". */
    endpointMissing?: boolean;
  } | null;
  overall: 'healthy' | 'degraded' | 'down';
}

export interface ContainerHealth {
  name: string;
  running: boolean;
  health: string;
}

export interface PrefetchedData {
  containers: ContainerInfo[];
  serviceStatus: ServiceStatus | null;
}

export function checkHealth(app: AppEntry, prefetched?: PrefetchedData): HealthResult {
  const systemd = prefetched !== undefined
    ? prefetched.serviceStatus
    : (systemdAvailable() ? getServiceStatus(app.serviceName) : null);
  const allContainers = prefetched !== undefined
    ? prefetched.containers
    : listContainers();

  const containers: ContainerHealth[] = app.containers.map(name => {
    const c = allContainers.find(ac => ac.name === name);
    return {
      name,
      running: c !== undefined && c.status.startsWith('Up'),
      health: c?.health ?? 'not found',
    };
  });

  let http: HealthResult['http'] = null;
  if (app.port) {
    http = checkHttp(app.port, app.healthPath);
  }

  const systemdOk = systemd ? systemd.active : true; // skip if unavailable
  const containersOk = containers.length > 0 && containers.every(c => c.running);
  const httpOk = http === null || http.ok;

  const overall = systemdOk && containersOk && httpOk ? 'healthy'
    : !containersOk ? 'down'
    : 'degraded';

  return {
    app: app.name,
    systemd: { ok: systemd?.active ?? false, state: systemd?.state ?? 'n/a' },
    containers,
    http,
    overall,
  };
}

export function checkHttp(port: number, healthPath?: string): HealthResult['http'] {
  const path = healthPath ?? '/health';
  assertHealthPath(path);
  const result = execSafe('curl', [
    '-s', '-o', '/dev/null', '-w', '%{http_code}',
    '--max-time', '5', `http://127.0.0.1:${port}${path}`,
  ], { timeout: 10_000 });

  const status = parseInt(result.stdout, 10);
  if (!isNaN(status) && status > 0) {
    // Healthy = 2xx (success) or 3xx (redirect, e.g. /health → /health/).
    // 4xx and 5xx are NOT healthy. 404 specifically is flagged so the TUI
    // can show "no healthcheck endpoint" rather than a generic failure —
    // it means the path was reachable but the route doesn't exist (the app
    // never implemented one). The fix is to add a /health route to the app.
    const ok = status >= 200 && status < 400;
    const endpointMissing = status === 404;
    return { ok, status, error: null, endpointMissing };
  }
  return { ok: false, status: null, error: result.stderr || 'Connection failed' };
}

export function checkAllHealth(apps: AppEntry[]): HealthResult[] {
  const allContainers = listContainers();
  const hasSystemd = systemdAvailable();
  const serviceStatuses = hasSystemd
    ? getMultipleServiceStatuses(apps.map(a => a.serviceName))
    : new Map<string, ServiceStatus>();

  return apps.map(app => checkHealth(app, {
    containers: allContainers,
    serviceStatus: serviceStatuses.get(app.serviceName) ?? null,
  }));
}
