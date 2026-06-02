import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { probeRunner } from '../core/runners/probe';
import { loadRunners, removeRunner, runnersPath, upsertRunner } from '../core/runners/store';
import type { RemoteHost } from '../core/runners/types';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

const HOST_ID = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, 'host id must be a lowercase slug');

export function registerRunnerTools(server: McpServer): void {
  server.tool(
    'fleet_runner_register',
    'Register or update a remote build host that fleet remote runner tasks target over ssh. ' +
      'Stored in the runner registry (FLEET_RUNNERS_FILE, else ~/.local/share/fleet/runners.json).',
    {
      id: HOST_ID.describe('host id, e.g. "mac-mini"'),
      destination: z.string().min(1).describe('ssh destination: user@host or an ssh_config alias'),
      port: z.number().int().positive().max(65535).optional().describe('ssh port when not 22'),
      identityFile: z.string().min(1).optional().describe('path to the private key fleet authenticates with'),
      defaultCwd: z.string().min(1).optional().describe('remote working dir used when a task omits one'),
    },
    async ({ id, destination, port, identityFile, defaultCwd }) => {
      const host: RemoteHost = { destination };
      if (port !== undefined) host.port = port;
      if (identityFile !== undefined) host.identityFile = identityFile;
      if (defaultCwd !== undefined) host.defaultCwd = defaultCwd;
      upsertRunner(id, host);
      return text(`Registered runner "${id}" -> ${destination} (${runnersPath()})`);
    },
  );

  server.tool('fleet_runner_list', 'List the registered remote build hosts.', async () => {
    const hosts = loadRunners();
    const ids = Object.keys(hosts).sort();
    if (ids.length === 0) return text('No runners registered.');
    return text(
      ids
        .map(id => {
          const h = hosts[id];
          return `${id} -> ${h.destination}${h.port ? `:${h.port}` : ''}`;
        })
        .join('\n'),
    );
  });

  server.tool(
    'fleet_runner_remove',
    'Remove a registered remote build host.',
    { id: HOST_ID },
    async ({ id }) => text(removeRunner(id) ? `Removed runner "${id}".` : `No runner "${id}" registered.`),
  );

  server.tool(
    'fleet_runner_status',
    'Doctor a registered remote build host over ssh: reachability plus a toolchain/disk preflight ' +
      '(os, node, full Xcode, free disk). Surfaces a host that cannot build before a run starts.',
    { id: HOST_ID },
    async ({ id }) => {
      const host = loadRunners()[id];
      if (!host) return text(`No runner "${id}" registered. Add one with fleet_runner_register.`);
      const p = await probeRunner(host);
      if (!p.reachable) return text(`ssh: unreachable — ${p.raw}`);
      return text(
        [
          `ssh: reachable (${host.destination})`,
          `os: ${p.os ?? 'unknown'}`,
          `node: ${p.node ?? 'none'}`,
          `xcode: ${p.xcode ?? 'none — command line tools only or absent; full Xcode needed for ios builds'}`,
          `disk free: ${p.diskFreeGb != null ? `${p.diskFreeGb} GB` : 'unknown'}`,
        ].join('\n'),
      );
    },
  );
}
