import { assertComposeFile } from '../core/validate';

interface SystemdOpts {
  serviceName: string;
  description: string;
  workingDirectory: string;
  composeFile: string | null;
  dependsOnDatabases: boolean;
  /**
   * add a hard dependency on fleet-unseal.service. the runtime secrets dir is a
   * tmpfs and is empty after every reboot; fleet-unseal refills it. an ordering
   * edge alone lets the app start when the unseal fails, and compose then has no
   * env file to read. pass true only when that unit exists — systemd refuses to
   * start a unit whose Requires= target is missing.
   */
  requiresUnseal?: boolean;
}

export function generateServiceFile(opts: SystemdOpts): string {
  // defence-in-depth: even if a caller skipped upstream validation, refuse to
  // emit a unit file with a composeFile value that could break out of the
  // quoted -f argument and inject extra docker-compose flags or shell.
  if (opts.composeFile) assertComposeFile(opts.composeFile);
  const fileFlag = opts.composeFile ? ` -f "${opts.composeFile}"` : '';
  const dbDep = opts.dependsOnDatabases ? ' docker-databases.service' : '';
  const unsealDep = opts.requiresUnseal ? ' fleet-unseal.service' : '';

  // no ExecStartPre teardown. at boot dockerd has already restarted the
  // container from its own restart policy; tearing it down before a start that
  // can fail leaves the app with no container at all. "compose up -d"
  // reconciles a running container on its own, so the teardown buys nothing.
  //
  // StartLimit* live in [Unit]. systemd ignores them in [Service].
  return `[Unit]
Description=${opts.description}
Requires=docker.service${dbDep}${unsealDep}
After=docker.service${dbDep}${unsealDep} network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${opts.workingDirectory}
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
