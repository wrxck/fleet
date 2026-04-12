import { load } from '../core/registry.js';
import { getMultipleServiceStatuses, systemdAvailable } from '../core/systemd.js';
import { listContainers } from '../core/docker.js';
import { c, icon, heading, table, info } from '../ui/output.js';

export interface StatusData {
  apps: Array<{
    name: string;
    service: string;
    systemd: string;
    containers: string;
    health: string;
  }>;
  totalApps: number;
  healthy: number;
  unhealthy: number;
}

export function getStatusData(): StatusData {
  const reg = load();
  const containers = listContainers();

  const hasSystemd = systemdAvailable();
  const serviceStatuses = hasSystemd
    ? getMultipleServiceStatuses(reg.apps.map(a => a.serviceName))
    : new Map();

  const apps = reg.apps.map(app => {
    const svc = serviceStatuses.get(app.serviceName) ?? null;
    const appContainers = containers.filter(ct =>
      app.containers.some(name => ct.name === name)
    );
    const allHealthy = appContainers.length > 0 &&
      appContainers.every(ct => ct.health === 'healthy' || ct.health === 'none');
    const allRunning = appContainers.every(ct => ct.status.startsWith('Up'));

    let health: string;
    if (app.frozenAt) {
      health = 'frozen';
    } else if (svc && !svc.active) {
      // systemd says service is not active — it's down
      health = 'down';
    } else if (appContainers.length === 0) {
      health = 'unknown';
    } else if (allHealthy && allRunning) {
      health = 'healthy';
    } else {
      health = 'degraded';
    }

    return {
      name: app.name,
      service: app.serviceName,
      systemd: svc?.state ?? 'n/a',
      containers: `${appContainers.filter(ct => ct.status.startsWith('Up')).length}/${app.containers.length}`,
      health,
    };
  });

  return {
    apps,
    totalApps: apps.length,
    healthy: apps.filter(a => a.health === 'healthy').length,
    unhealthy: apps.filter(a => a.health !== 'healthy').length,
  };
}

export function statusCommand(args: string[]): void {
  const json = args.includes('--json');
  const data = getStatusData();

  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  heading('Fleet Dashboard');
  info(`${data.totalApps} apps | ${c.green}${data.healthy} healthy${c.reset} | ${data.unhealthy > 0 ? c.red : c.dim}${data.unhealthy} unhealthy${c.reset}`);

  const rows = data.apps.map(app => {
    const healthIcon = app.health === 'healthy' ? icon.ok
      : app.health === 'frozen' ? icon.info
      : app.health === 'degraded' ? icon.warn
      : icon.err;
    const systemdColor = app.systemd === 'active' ? c.green : c.red;
    return [
      `${c.bold}${app.name}${c.reset}`,
      `${systemdColor}${app.systemd}${c.reset}`,
      app.containers,
      `${healthIcon} ${app.health}`,
    ];
  });

  table(['APP', 'SYSTEMD', 'CONTAINERS', 'HEALTH'], rows);
  process.stdout.write('\n');
}
