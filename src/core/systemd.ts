import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { exec } from './exec.js';

let _systemdAvailable: boolean | null = null;

export function systemdAvailable(): boolean {
  if (_systemdAvailable === null) {
    const result = exec('systemctl is-system-running');
    // Returns "running", "degraded", etc. when systemd is PID 1.
    // Returns "offline" when not booted with systemd.
    _systemdAvailable = result.ok || result.stdout === 'degraded';
  }
  return _systemdAvailable;
}

export interface ServiceStatus {
  name: string;
  active: boolean;
  enabled: boolean;
  state: string;
  description: string;
}

export function getServiceStatus(serviceName: string): ServiceStatus {
  const active = exec(`systemctl is-active ${serviceName}.service`);
  const enabled = exec(`systemctl is-enabled ${serviceName}.service`);
  const show = exec(`systemctl show ${serviceName}.service --property=Description --value`);

  return {
    name: serviceName,
    active: active.stdout === 'active',
    enabled: enabled.stdout === 'enabled',
    state: active.stdout || 'unknown',
    description: show.stdout || '',
  };
}

export function startService(serviceName: string): boolean {
  return exec(`systemctl start ${serviceName}.service`, { timeout: 60_000 }).ok;
}

export function stopService(serviceName: string): boolean {
  return exec(`systemctl stop ${serviceName}.service`, { timeout: 60_000 }).ok;
}

export function restartService(serviceName: string): boolean {
  return exec(`systemctl restart ${serviceName}.service`, { timeout: 120_000 }).ok;
}

export function enableService(serviceName: string): boolean {
  return exec(`systemctl enable ${serviceName}.service`).ok;
}

export function disableService(serviceName: string): boolean {
  return exec(`systemctl disable ${serviceName}.service`).ok;
}

export function installServiceFile(serviceName: string, content: string): void {
  const path = `/etc/systemd/system/${serviceName}.service`;
  writeFileSync(path, content);
  exec('systemctl daemon-reload');
}

export function readServiceFile(serviceName: string): string | null {
  const path = `/etc/systemd/system/${serviceName}.service`;
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function discoverServices(): string[] {
  const result = exec(
    'systemctl list-units --type=service --state=active --no-legend --no-pager',
    { timeout: 10_000 }
  );
  if (!result.ok) return [];

  return result.stdout.split('\n')
    .map(line => line.trim().split(/\s+/)[0]?.replace('.service', '') ?? '')
    .filter(name => {
      const content = readServiceFile(name);
      return content !== null && content.includes('docker compose');
    });
}

export function parseServiceFile(content: string): {
  workingDirectory: string;
  composeFile: string | null;
  dependsOnDatabases: boolean;
} {
  const wdMatch = content.match(/WorkingDirectory=(.+)/);
  const composeFileMatch = content.match(/-f\s+(\S+\.ya?ml)/);
  const dbDep = content.includes('docker-databases.service');

  return {
    workingDirectory: wdMatch?.[1] ?? '',
    composeFile: composeFileMatch?.[1] ?? null,
    dependsOnDatabases: dbDep,
  };
}
