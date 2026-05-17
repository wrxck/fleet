import { z } from 'zod';

import { load } from '../core/registry';
import { getMultipleServiceStatuses, systemdAvailable } from '../core/systemd';
import { listContainers } from '../core/docker';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

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

export const statusCommand = defineCommand({
  name: 'status',
  summary: 'Dashboard: all apps, systemd state, containers, health',
  args: z.object({}),
  tui: { view: 'dashboard' },
  async run(): Promise<CommandResult<StatusData>> {
    const data = getStatusData();
    return {
      ok: true,
      summary: `${data.totalApps} apps | ${data.healthy} healthy | ${data.unhealthy} unhealthy`,
      data,
      render: {
        kind: 'table',
        columns: ['APP', 'SYSTEMD', 'CONTAINERS', 'HEALTH'],
        rows: data.apps.map(a => [a.name, a.systemd, a.containers, a.health]),
      },
    };
  },
});
