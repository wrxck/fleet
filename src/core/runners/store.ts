import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { RemoteHost } from './types';
import { isValidHost } from './validate';

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
    // re-validate every entry on load: a registry that was tampered with
    // directly (bypassing fleet_runner_register) must not be able to feed an
    // ssh-flag-injecting destination into a command line. invalid entries are
    // dropped so the affected host simply fails to resolve (fail closed).
    const out: Record<string, RemoteHost> = {};
    for (const [id, host] of Object.entries(parsed as Record<string, RemoteHost>)) {
      if (isValidHost(host)) out[id] = host;
    }
    return out;
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
