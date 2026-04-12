interface SystemdOpts {
  serviceName: string;
  description: string;
  workingDirectory: string;
  composeFile: string | null;
  dependsOnDatabases: boolean;
}

export function generateServiceFile(opts: SystemdOpts): string {
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
ExecStart=/usr/bin/docker compose${fileFlag} up -d --force-recreate
ExecStop=/usr/bin/docker compose${fileFlag} down --timeout 30
ExecReload=/usr/bin/docker compose${fileFlag} restart
TimeoutStartSec=300
TimeoutStopSec=60
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}
