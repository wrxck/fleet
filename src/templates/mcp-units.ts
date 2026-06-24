import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localEntry = join(__dirname, '..', '..', 'dist', 'index.js');
const GLOBAL_ENTRY = '/usr/local/lib/node_modules/@matthesketh/fleet/dist/index.js';

export const MCP_SERVICE_PATH = '/etc/systemd/system/fleet-mcp.service';
export const MCP_SOCKET_PATH = '/etc/systemd/system/fleet-mcp.socket';

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

// the .socket unit. systemd creates and owns /run/fleet-mcp/mcp.sock with the
// declared user/group/mode BEFORE the daemon starts, so the socket is never
// momentarily world-accessible (no listen-then-chmod race) and the guard-group
// ACL is enforced by systemd itself. socket activation hands the listening fd
// to the daemon (fd 3), which its listenFd() path picks up.
export function generateMcpSocket(): string {
  return `[Unit]
Description=Fleet MCP root daemon socket
PartOf=fleet-mcp.service

[Socket]
ListenStream=/run/fleet-mcp/mcp.sock
SocketUser=root
SocketGroup=fleet-guard
SocketMode=0660
# the socket's 0660 root:fleet-guard mode is the access boundary; the parent
# dir stays world-traversable (others still cannot connect to the socket).
RuntimeDirectory=fleet-mcp
RuntimeDirectoryMode=0755

[Install]
WantedBy=sockets.target
`;
}

// long-lived root daemon. it runs the privileged side of the mcp split and is
// fronted by fleet-mcp.socket (systemd owns the socket perms). it must run as
// root because its tools manage systemd, docker, nginx and the vault.
export function generateMcpService(): string {
  const { entry } = resolveDaemonEntry();
  return `[Unit]
Description=Fleet MCP root daemon (privileged tool broker)
After=network.target fleet-unseal.service
Wants=fleet-unseal.service
Requires=fleet-mcp.socket
After=fleet-mcp.socket

[Service]
Type=simple
ExecStart=/usr/bin/node ${entry} mcp daemon
Restart=on-failure
RestartSec=2
RuntimeDirectory=fleet-mcp
RuntimeDirectoryMode=0755
# the daemon is intentionally NOT sandboxed: its tools drive systemctl, docker
# and nginx, so it needs full root. access control is the socket mode + group,
# now enforced by systemd via fleet-mcp.socket.

[Install]
WantedBy=multi-user.target
`;
}
