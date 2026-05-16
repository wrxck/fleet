import { assertComposeFile } from '../core/validate.js';

interface SystemdOpts {
  serviceName: string;
  description: string;
  workingDirectory: string;
  composeFile: string | null;
  dependsOnDatabases: boolean;
}

export function generateServiceFile(opts: SystemdOpts): string {
  // Defence-in-depth: even if a caller skipped upstream validation, refuse to
  // emit a unit file with a composeFile value that could break out of the
  // quoted -f argument and inject extra docker-compose flags or shell.
  if (opts.composeFile) assertComposeFile(opts.composeFile);
  const fileFlag = opts.composeFile ? ` -f "${opts.composeFile}"` : '';
  const dbDep = opts.dependsOnDatabases ? ' docker-databases.service' : '';

  return `[Unit]
Description=${opts.description}
Requires=docker.service${dbDep}
After=docker.service${dbDep} network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${opts.workingDirectory}
ExecStartPre=-/usr/bin/docker compose${fileFlag} down
ExecStart=/usr/bin/env fleet boot-start ${opts.serviceName}
ExecStop=/usr/bin/docker compose${fileFlag} down --timeout 30
ExecReload=/usr/bin/docker compose${fileFlag} restart
TimeoutStartSec=900
TimeoutStopSec=60
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}
