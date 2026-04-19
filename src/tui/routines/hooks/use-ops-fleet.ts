import { useEffect, useState } from 'react';

import type { AppEntry } from '@/core/registry.js';
import { execSafe } from '@/core/exec.js';
import { getMultipleServiceStatuses, type ServiceStatus } from '@/core/systemd.js';

export interface OpsRepoState {
  name: string;
  service: ServiceStatus | null;
  runningContainers: number;
  totalContainers: number;
}

export interface OpsSnapshot {
  loading: boolean;
  repos: OpsRepoState[];
  nginxSites: number | null;
  nginxOk: boolean | null;
  dockerDatabasesActive: boolean | null;
  diskPercent: number | null;
  refreshedAt: number;
}

function countContainersByProject(project: string): { running: number; total: number } {
  const res = execSafe('docker', [
    'ps', '--all',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--format', '{{.State}}',
  ], { timeout: 5000 });
  if (!res.ok) return { running: 0, total: 0 };
  const states = res.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  return { running: states.filter(s => s === 'running').length, total: states.length };
}

function nginxHealth(): { sites: number | null; ok: boolean | null } {
  const test = execSafe('nginx', ['-t'], { timeout: 4000 });
  const list = execSafe('bash', ['-c', "ls /etc/nginx/sites-enabled/ 2>/dev/null | wc -l"], { timeout: 3000 });
  const count = list.ok ? parseInt(list.stdout.trim(), 10) : null;
  return { sites: Number.isFinite(count) ? count : null, ok: test.ok };
}

function diskPercent(path: string): number | null {
  const res = execSafe('bash', ['-c', `df -P ${path} | awk 'NR==2 {gsub("%",""); print $5}'`], { timeout: 3000 });
  if (!res.ok) return null;
  const v = parseInt(res.stdout.trim(), 10);
  return Number.isFinite(v) ? v : null;
}

export function useOpsFleet(apps: AppEntry[]): OpsSnapshot & { refresh(): void } {
  const [state, setState] = useState<OpsSnapshot>({
    loading: false,
    repos: [],
    nginxSites: null,
    nginxOk: null,
    dockerDatabasesActive: null,
    diskPercent: null,
    refreshedAt: 0,
  });

  const load = (): void => {
    setState(s => ({ ...s, loading: true }));

    const serviceNames = apps.map(a => a.serviceName).filter(Boolean);
    const allServiceNames = Array.from(new Set([...serviceNames, 'docker-databases']));
    const serviceMap = getMultipleServiceStatuses(allServiceNames);

    const repos: OpsRepoState[] = apps.map(app => {
      const counts = countContainersByProject(app.name);
      return {
        name: app.name,
        service: serviceMap.get(app.serviceName) ?? null,
        runningContainers: counts.running,
        totalContainers: counts.total,
      };
    });

    const nginx = nginxHealth();
    const disk = diskPercent('/home');

    setState({
      loading: false,
      repos,
      nginxSites: nginx.sites,
      nginxOk: nginx.ok,
      dockerDatabasesActive: serviceMap.get('docker-databases')?.active ?? null,
      diskPercent: disk,
      refreshedAt: Date.now(),
    });
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [apps.map(a => a.name).join('|')]);

  return { ...state, refresh: load };
}
