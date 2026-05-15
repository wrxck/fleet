import { FleetError } from '../errors';

import { DumpHook } from './types';

export class DumpError extends FleetError {}

/** sh single-quote escape — wraps s in '...' with embedded quotes escaped
 * as '\''. safe even if s contains $, `, \, *, spaces, or single quotes. */
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** returns the shell command that streams a database dump to stdout.
 * caller pipes the output into `restic backup --stdin` via sh -c so the
 * dump bytes flow kernel-to-kernel and never enter node's spawnSync
 * buffer (which has a 1mb ceiling and dies on multi-gb dumps). */
export function dumpStreamCommand(hook: DumpHook): string {
  switch (hook.type) {
    case 'postgres': {
      // postgres_user is set as env in shared-postgres compose; password
      // auth not needed because pg_dumpall runs as the postgres unix user
      // and gets peer auth on the unix socket inside the container.
      const user = hook.user ? shq(hook.user) : `"$${hook.userEnv ?? 'POSTGRES_USER'}"`;
      const inner = hook.db
        ? `pg_dump -U ${user} -d ${shq(hook.db)} --no-owner --no-acl --clean --if-exists`
        : `pg_dumpall -U ${user} --no-role-passwords`;
      return `docker exec ${hook.container} sh -c ${shq(inner)}`;
    }
    case 'mysql': {
      const user = hook.user ?? (hook.userEnv ? `\${${hook.userEnv}}` : 'root');
      const dbFlag = hook.db ? shq(hook.db) : '--all-databases';
      const passwordExpr = hook.passwordFile
        ? `"$(cat ${shq(hook.passwordFile)})"`
        : hook.passwordEnv
          ? `"\${${hook.passwordEnv}}"`
          : '"${MYSQL_ROOT_PASSWORD}"';
      const inner = `mysqldump -u${user} -p${passwordExpr} --single-transaction --routines --triggers ${dbFlag}`;
      return `docker exec ${hook.container} sh -c ${shq(inner)}`;
    }
    case 'mongo': {
      const user = hook.user ?? (hook.userEnv ? `\${${hook.userEnv}}` : 'root');
      const dbFlag = hook.db ? `--db=${shq(hook.db)}` : '';
      const passwordExpr = hook.passwordFile
        ? `"$(cat ${shq(hook.passwordFile)})"`
        : hook.passwordEnv
          ? `"\${${hook.passwordEnv}}"`
          : '"${MONGO_INITDB_ROOT_PASSWORD}"';
      const inner = `mongodump --archive --quiet --username ${user} --password ${passwordExpr} --authenticationDatabase admin ${dbFlag}`.trim();
      return `docker exec ${hook.container} sh -c ${shq(inner)}`;
    }
    case 'redis': {
      const portFlag = hook.port ? `-p ${hook.port}` : '';
      // redis-cli --rdb writes to a tempfile, then we cat it. >/dev/null on
      // the rdb step keeps redis-cli's progress chatter out of the stream.
      // when a host command supplies the password, inject it via docker exec
      // -e so it never lives on the redis-cli cmdline (which would show in
      // ps inside the container).
      if (hook.passwordHostCommand) {
        const inner = `redis-cli --no-auth-warning ${portFlag} -a "$REDIS_PASSWORD" --rdb /tmp/dump.rdb >/dev/null && cat /tmp/dump.rdb`;
        return `docker exec -e REDIS_PASSWORD="$(${hook.passwordHostCommand})" ${hook.container} sh -c ${shq(inner)}`;
      }
      const passwordExpr = hook.passwordFile
        ? `"$(cat ${shq(hook.passwordFile)})"`
        : hook.passwordEnv
          ? `"\${${hook.passwordEnv}}"`
          : '"${REDIS_PASSWORD:-}"';
      const inner = `redis-cli --no-auth-warning ${portFlag} -a ${passwordExpr} --rdb /tmp/dump.rdb >/dev/null && cat /tmp/dump.rdb`;
      return `docker exec ${hook.container} sh -c ${shq(inner)}`;
    }
    default:
      throw new DumpError(`unsupported dump type: ${(hook as DumpHook).type}`);
  }
}

/** filename used inside the restic snapshot for the dump stream. */
export function dumpFilename(hook: DumpHook): string {
  switch (hook.type) {
    case 'postgres':
      return `${hook.db ?? 'all'}.pg.sql`;
    case 'mysql':
      return `${hook.db ?? 'all'}.mysql.sql`;
    case 'mongo':
      return `${hook.db ?? 'all'}.mongo.archive`;
    case 'redis':
      return `dump.rdb`;
  }
}
