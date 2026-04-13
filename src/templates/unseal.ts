import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../core/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fleetBin = join(__dirname, '..', '..', 'dist', 'index.js');

export function generateUnsealService(): string {
  const reg = load();
  const serviceNames = reg.apps.map(a => a.serviceName + '.service');
  const dbService = reg.infrastructure.databases.serviceName + '.service';
  const allServices = [dbService, ...serviceNames].join(' ');

  return `[Unit]
Description=Fleet Secrets Unseal
After=local-fs.target
Before=${allServices}

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/node ${fleetBin} secrets unseal
ExecStop=/bin/rm -rf /run/fleet-secrets
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
`;
}
