import { load } from '../core/registry.js';

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
ExecStart=/usr/bin/node /home/matt/fleet/dist/index.js secrets unseal
ExecStop=/bin/rm -rf /run/fleet-secrets
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
`;
}
