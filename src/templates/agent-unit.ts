/** build the templated systemd unit for fleet-secrets-agent@%i.service.
 *  the vault path comes from the caller — production code passes whatever
 *  FLEET_VAULT_DIR or the repo-local default resolves to, so this template
 *  never carries an operator-specific assumption. */
export function generateAgentUnit(vaultPath: string): string {
  return [
    '[Unit]',
    'Description=Fleet Secrets Agent for %i',
    'After=network.target',
    'PartOf=docker-%i.service',
    '',
    '[Service]',
    'Type=notify',
    'DynamicUser=yes',
    'RuntimeDirectory=fleet-secrets',
    'RuntimeDirectoryPreserve=yes',
    'LoadCredentialEncrypted=age-key:/etc/fleet/credentials/%i.cred',
    `ExecStart=/usr/local/bin/fleet-agent --app %i --vault ${vaultPath} --socket /run/fleet-secrets/%i.sock`,
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '# hardening',
    'ProtectSystem=strict',
    'ProtectHome=read-only',
    `ReadOnlyPaths=${vaultPath}`,
    'PrivateTmp=yes',
    'NoNewPrivileges=yes',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectControlGroups=yes',
    'RestrictAddressFamilies=AF_UNIX',
    'RestrictNamespaces=yes',
    'SystemCallFilter=@system-service',
    'SystemCallFilter=~@privileged @resources @mount',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}
