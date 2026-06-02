import { loadRunners } from '../../core/runners/store';
import type { RemoteHost } from '../../core/runners/types';

// build a resolver the remote runner uses to turn a task's host id into its
// connection. defaults to the on-disk registry (managed by the fleet_runner_*
// mcp tools); accepts an explicit map for tests.
export function createHostResolver(
  hosts: Record<string, RemoteHost> = loadRunners(),
): (id: string) => RemoteHost | null {
  return (id: string) => hosts[id] ?? null;
}
