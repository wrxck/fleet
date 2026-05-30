import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localEntry = join(__dirname, '..', '..', 'dist', 'index.js');
const GLOBAL_ENTRY = '/usr/local/lib/node_modules/@matthesketh/fleet/dist/index.js';

export const MCP_SERVICE_PATH = '/etc/systemd/system/fleet-mcp.service';

// true when p sits inside a git working tree (a .git exists in some ancestor).
export function isInsideGitCheckout(p: string): boolean {
  let dir = dirname(p);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// choose the entry the daemon runs. prefer a global install whose real path is NOT
// inside a git checkout: running a root daemon from a user checkout risks .git
// ownership corruption (root-owned objects block the owner's commits) and lets the
// executed code be rewritten by an unprivileged user. fall back to the local dist
// when there is no clean global install, flagging that it came from a checkout so
// the installer can warn.
export function resolveDaemonEntry(): { entry: string; fromCheckout: boolean } {
  if (existsSync(GLOBAL_ENTRY) && !isInsideGitCheckout(realpathSync(GLOBAL_ENTRY))) {
    return { entry: GLOBAL_ENTRY, fromCheckout: false };
  }
  return { entry: localEntry, fromCheckout: isInsideGitCheckout(localEntry) };
}

// long-lived root daemon. it runs the privileged side of the mcp split and binds
// /run/fleet-mcp/mcp.sock, which it locks to root:fleet-guard 0660 itself. it must
// run as root because its tools manage systemd, docker, nginx and the vault.
// RuntimeDirectory makes systemd create and tear down /run/fleet-mcp.
export function generateMcpService(): string {
  const { entry } = resolveDaemonEntry();
  return `[Unit]
Description=Fleet MCP root daemon (privileged tool broker)
After=network.target fleet-unseal.service
Wants=fleet-unseal.service

[Service]
Type=simple
ExecStart=/usr/bin/node ${entry} mcp daemon
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
