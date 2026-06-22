import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { RemoteHost } from './types';

// the runner registry path: FLEET_RUNNERS_FILE when set, else the fleet local
// state dir (matching src/core/secrets-audit.ts). a vault-backed registry can
// replace this later without changing the tools or the resolver.
export function runnersPath(): string {
  return process.env.FLEET_RUNNERS_FILE ?? join(homedir(), '.local', 'share', 'fleet', 'runners.json');
}

export function loadRunners(path: string = runnersPath()): Record<string, RemoteHost> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, RemoteHost>;
  } catch {
    // missing or unreadable -> no hosts; remote tasks then fail closed.
    return {};
  }
}

export function saveRunners(hosts: Record<string, RemoteHost>, path: string = runnersPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(hosts, null, 2)}\n`, { mode: 0o600 });
}

export function upsertRunner(id: string, host: RemoteHost, path: string = runnersPath()): void {
  const hosts = loadRunners(path);
  hosts[id] = host;
  saveRunners(hosts, path);
}

export function removeRunner(id: string, path: string = runnersPath()): boolean {
  const hosts = loadRunners(path);
  if (!(id in hosts)) return false;
  delete hosts[id];
  saveRunners(hosts, path);
  return true;
}
