import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, chownSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { execSafe } from '../core/exec';
import { buildFleetServer } from './server';
import { SocketServerTransport } from './socket-transport';
import { Guard } from './guard';
import { socketPath, GUARD_GROUP } from './socket-path';

// resolve the numeric gid of the guard group, or null when it does not exist.
export function resolveGuardGid(group = GUARD_GROUP): number | null {
  const r = execSafe('getent', ['group', group]);
  if (!r.ok) return null;
  const gid = Number(r.stdout.split(':')[2]);
  return Number.isInteger(gid) ? gid : null;
}

export interface PermOps {
  chown: (p: string, uid: number, gid: number) => void;
  chmod: (p: string, mode: number) => void;
}

// lock a freshly created socket (and its directory) to root:fleet-guard 0660 so
// only root and members of the guard group can connect. when systemd creates the
// socket via socket activation it sets these via the .socket unit instead. the fs
// ops are injectable so the perms logic can be asserted in tests without root.
export function securePermissions(
  path: string,
  gid: number | null,
  ops: PermOps = { chown: chownSync, chmod: chmodSync },
): void {
  const dir = dirname(path);
  if (gid !== null) {
    ops.chown(dir, 0, gid);
    ops.chmod(dir, 0o750);
    ops.chown(path, 0, gid);
  }
  ops.chmod(path, 0o660);
}

// build a per-connection mcp server and wire it to a socket transport. exported
// so tests can drive a connection without a real listener.
export function handleConnection(guard: Guard, socket: Socket): void {
  socket.on('error', () => socket.destroy());
  const server = buildFleetServer({ guard });
  const transport = new SocketServerTransport(socket);
  server.connect(transport).catch(() => socket.destroy());
}

// detect systemd socket activation (LISTEN_FDS / LISTEN_PID handed to this pid).
// when present, the listening socket is fd 3 and systemd already set its perms.
function listenFd(): number | null {
  const pid = Number(process.env.LISTEN_PID);
  const count = Number(process.env.LISTEN_FDS);
  if (pid === process.pid && count >= 1) return 3; // SD_LISTEN_FDS_START
  return null;
}

export interface DaemonHandle {
  server: Server;
  close: () => Promise<void>;
}

// start the root mcp daemon. refuses to run unless euid 0 — privileged tools are
// the whole point, and a non-root daemon would only fail later on file perms.
export async function startMcpDaemon(): Promise<DaemonHandle> {
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('fleet mcp daemon must run as root (it is the privileged side of the split)');
  }

  const guard = new Guard();
  const server = createServer((socket) => handleConnection(guard, socket));

  const fd = listenFd();
  const path = socketPath();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (fd !== null) {
      server.listen({ fd }, resolve);
    } else {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o750 });
      if (existsSync(path)) rmSync(path); // clear a stale socket from a crash
      server.listen(path, () => {
        try {
          securePermissions(path, resolveGuardGid());
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
    }
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        if (fd === null && existsSync(path)) {
          try { rmSync(path); } catch { /* best effort */ }
        }
        resolve();
      });
    });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => { void close().then(() => process.exit(0)); });
  }

  return { server, close };
}
