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

function parseSystemctlShow(output: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      props[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return props;
}

export function getServiceStatus(serviceName: string): ServiceStatus {
  const result = exec(
    `systemctl show ${serviceName}.service --property=ActiveState,UnitFileState,Description --no-pager`,
  );
  const props = parseSystemctlShow(result.stdout);

  return {
    name: serviceName,
    active: props.ActiveState === 'active',
    enabled: props.UnitFileState === 'enabled',
    state: props.ActiveState || 'unknown',
    description: props.Description || '',
  };
}

export function getMultipleServiceStatuses(serviceNames: string[]): Map<string, ServiceStatus> {
  if (serviceNames.length === 0) return new Map();

  const args = serviceNames.map(n => `${n}.service`).join(' ');
  const result = exec(
    `systemctl show ${args} --property=Id,ActiveState,UnitFileState,Description --no-pager`,
    { timeout: 15_000 },
  );

  const map = new Map<string, ServiceStatus>();
  if (!result.stdout) return map;

  const blocks = result.stdout.split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    const props = parseSystemctlShow(block);
    const name = (props.Id || '').replace(/\.service$/, '');
    if (name) {
      map.set(name, {
        name,
        active: props.ActiveState === 'active',
        enabled: props.UnitFileState === 'enabled',
        state: props.ActiveState || 'unknown',
        description: props.Description || '',
      });
    }
  }

  return map;
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
