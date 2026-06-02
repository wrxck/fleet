import { readFileSync } from 'node:fs';

import type { RemoteHost } from './remote';

// milestone-1 host registry: a json map of host id -> connection, named by the
// FLEET_RUNNERS_FILE env var, e.g.
//   { "mac-mini": { "destination": "matt@localhost", "port": 2222,
//     "identityFile": "/home/matt/.ssh/id_mac_runner", "defaultCwd": "~/build" } }
// returns an empty map when the var is unset or the file is unreadable, so a
// remote task then fails closed with "unknown remote host". a vault-backed
// registry (age-encrypted, managed via fleet_runner_register) replaces this.
export function loadRemoteHosts(): Record<string, RemoteHost> {
  const path = process.env.FLEET_RUNNERS_FILE;
  if (!path) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, RemoteHost>;
  } catch {
    return {};
  }
}

export function createHostResolver(
  hosts: Record<string, RemoteHost> = loadRemoteHosts(),
): (id: string) => RemoteHost | null {
  return (id: string) => hosts[id] ?? null;
}
