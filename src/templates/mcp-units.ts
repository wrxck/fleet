import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fleetBin = join(__dirname, '..', '..', 'dist', 'index.js');

export const MCP_SERVICE_PATH = '/etc/systemd/system/fleet-mcp.service';

// long-lived root daemon. it runs the privileged side of the mcp split and binds
// /run/fleet-mcp/mcp.sock, which it locks to root:fleet-guard 0660 itself. it must
// run as root because its tools manage systemd, docker, nginx and the vault.
// RuntimeDirectory makes systemd create and tear down /run/fleet-mcp.
export function generateMcpService(): string {
  return `[Unit]
Description=Fleet MCP root daemon (privileged tool broker)
After=network.target fleet-unseal.service
Wants=fleet-unseal.service

[Service]
Type=simple
ExecStart=/usr/bin/node ${fleetBin} mcp daemon
Restart=on-failure
RestartSec=2
RuntimeDirectory=fleet-mcp
RuntimeDirectoryMode=0755
# the daemon is intentionally NOT sandboxed: its tools drive systemctl, docker
# and nginx, so it needs full root. access control is the socket mode + group.

[Install]
WantedBy=multi-user.target
`;
}
