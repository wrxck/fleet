import { exec } from './exec.js';
import { getServiceStatus, systemdAvailable } from './systemd.js';
import { listContainers } from './docker.js';
import type { AppEntry } from './registry.js';

export interface HealthResult {
  app: string;
  systemd: { ok: boolean; state: string };
  containers: ContainerHealth[];
  http: { ok: boolean; status: number | null; error: string | null } | null;
  overall: 'healthy' | 'degraded' | 'down';
}

export interface ContainerHealth {
  name: string;
  running: boolean;
  health: string;
}

export function checkHealth(app: AppEntry): HealthResult {
  const hasSystemd = systemdAvailable();
  const systemd = hasSystemd ? getServiceStatus(app.serviceName) : null;
  const allContainers = listContainers();

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
  const result = exec(
    `curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:${port}${path}`,
    { timeout: 10_000 }
  );

  const status = parseInt(result.stdout, 10);
  if (!isNaN(status) && status > 0) {
    return { ok: status >= 200 && status < 500, status, error: null };
  }
  return { ok: false, status: null, error: result.stderr || 'Connection failed' };
}

export function checkAllHealth(apps: AppEntry[]): HealthResult[] {
  return apps.map(app => checkHealth(app));
}
