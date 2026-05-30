import { connect } from 'node:net';

import { socketPath, GUARD_GROUP } from './socket-path';

// client-side proxy: dial the root daemon's unix socket and shuttle bytes between
// it and this process's stdio. spawned by the mcp client (claude) as the ordinary
// user; it holds no privilege of its own and only needs connect permission on the
// socket, which the kernel restricts to root and the guard group.
export function mcpConnect(): void {
  const path = socketPath();
  const sock = connect(path);

  sock.on('connect', () => {
    process.stdin.pipe(sock);
    sock.pipe(process.stdout);
  });

  sock.on('error', (err) => {
    const e = err as NodeJS.ErrnoException;
    let msg: string;
    if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
      msg = `fleet mcp: no daemon at ${path}. start it with: sudo systemctl start fleet-mcp.socket`;
    } else if (e.code === 'EACCES') {
      msg = `fleet mcp: permission denied on ${path}. add yourself to '${GUARD_GROUP}' and re-login: sudo usermod -aG ${GUARD_GROUP} "$USER"`;
    } else {
      msg = `fleet mcp: cannot reach daemon at ${path}: ${e.message}`;
    }
    process.stderr.write(msg + '\n');
    process.exit(1);
  });

  // when either side hangs up, tear the proxy down so the client sees a clean eof.
  sock.on('close', () => process.exit(0));
  process.stdin.on('end', () => sock.end());
}
