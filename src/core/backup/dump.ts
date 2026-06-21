import { FleetError } from '../errors';

import { DumpHook } from './types';

export class DumpError extends FleetError {}

/** sh single-quote escape — wraps s in '...' with embedded quotes escaped
 * as '\''. safe even if s contains $, `, \, *, spaces, or single quotes. */
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** emit a value as a shell token: a plain bareword (docker names, usernames,
 * versions) passes through unchanged; anything containing a shell-meaningful
 * character is single-quoted so it cannot inject. closes the original gaps
 * where `container`/`user` were interpolated raw into the dump command. */
function shToken(s: string): string {
  return /^[A-Za-z0-9_.:@-]+$/.test(s) ? s : shq(s);
}

/** env var names are interpolated unquoted into `${NAME}` / `"$NAME"` shell
 * expansions, so they must be real identifiers — otherwise a crafted name like
 * `X}; rm -rf / ;${` would break out of the expansion. */
function assertEnvName(name: string, field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new DumpError(`invalid ${field} (not a shell identifier): ${name}`);
  }
  return name;
}

/** the dump tool's user argument. a literal user is emitted as a safe shell
 * token; an env var form expands at runtime; otherwise the type's default. */
function userArg(hook: { user?: string; userEnv?: string }, fallback: string): string {
  if (hook.user !== undefined) return shToken(hook.user);
  if (hook.userEnv) return `"\${${assertEnvName(hook.userEnv, 'userEnv')}}"`;
  return fallback;
}

/** returns the shell command that streams a database dump to stdout.
 * caller pipes the output into `restic backup --stdin` via sh -c so the
 * dump bytes flow kernel-to-kernel and never enter node's spawnSync
 * buffer (which has a 1mb ceiling and dies on multi-gb dumps). */
export function dumpStreamCommand(hook: DumpHook): string {
  const container = shToken(hook.container);
  const passwordExprFrom = (envDefault: string): string =>
    hook.passwordFile
      ? `"$(cat ${shq(hook.passwordFile)})"`
      : hook.passwordEnv
        ? `"\${${assertEnvName(hook.passwordEnv, 'passwordEnv')}}"`
        : envDefault;

  switch (hook.type) {
    case 'postgres': {
      // postgres_user is set as env in shared-postgres compose; password
      // auth not needed because pg_dumpall runs as the postgres unix user
      // and gets peer auth on the unix socket inside the container.
      const user = userArg(hook, '"$POSTGRES_USER"');
      const inner = hook.db
        ? `pg_dump -U ${user} -d ${shq(hook.db)} --no-owner --no-acl --clean --if-exists`
        : `pg_dumpall -U ${user} --no-role-passwords`;
      return `docker exec ${container} sh -c ${shq(inner)}`;
    }
    case 'mysql': {
      const user = userArg(hook, 'root');
      const dbFlag = hook.db ? shq(hook.db) : '--all-databases';
      const passwordExpr = passwordExprFrom('"${MYSQL_ROOT_PASSWORD}"');
      const inner = `mysqldump -u${user} -p${passwordExpr} --single-transaction --routines --triggers ${dbFlag}`;
      return `docker exec ${container} sh -c ${shq(inner)}`;
    }
    case 'mongo': {
      const user = userArg(hook, 'root');
      const dbFlag = hook.db ? `--db=${shq(hook.db)}` : '';
      const passwordExpr = passwordExprFrom('"${MONGO_INITDB_ROOT_PASSWORD}"');
      const inner = `mongodump --archive --quiet --username ${user} --password ${passwordExpr} --authenticationDatabase admin ${dbFlag}`.trim();
      return `docker exec ${container} sh -c ${shq(inner)}`;
    }
    case 'redis': {
      // port is interpolated into the command line — it must be a plain integer.
      if (hook.port !== undefined && !Number.isInteger(hook.port)) {
        throw new DumpError(`invalid redis port: ${hook.port}`);
      }
      const portFlag = hook.port ? `-p ${hook.port}` : '';
      // redis-cli --rdb writes to a tempfile, then we cat it. >/dev/null on
      // the rdb step keeps redis-cli's progress chatter out of the stream.
      // when a host command supplies the password, inject it via docker exec
      // -e so it never lives on the redis-cli cmdline (which would show in
      // ps inside the container).
      if (hook.passwordHostCommand) {
        const inner = `redis-cli --no-auth-warning ${portFlag} -a "$REDIS_PASSWORD" --rdb /tmp/dump.rdb >/dev/null && cat /tmp/dump.rdb`;
        return `docker exec -e REDIS_PASSWORD="$(${hook.passwordHostCommand})" ${container} sh -c ${shq(inner)}`;
      }
      const passwordExpr = passwordExprFrom('"${REDIS_PASSWORD:-}"');
      const inner = `redis-cli --no-auth-warning ${portFlag} -a ${passwordExpr} --rdb /tmp/dump.rdb >/dev/null && cat /tmp/dump.rdb`;
      return `docker exec ${container} sh -c ${shq(inner)}`;
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
