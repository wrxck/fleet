import { describe, it, expect } from 'vitest';

import { dumpStreamCommand, dumpFilename, DumpError } from './dump';

describe('dumpStreamCommand', () => {
  it('postgres: pg_dumpall with explicit user, no db, peer auth', () => {
    const cmd = dumpStreamCommand({ type: 'postgres', container: 'shared-postgres', user: 'postgres' });
    expect(cmd).toContain('docker exec shared-postgres');
    expect(cmd).toContain('pg_dumpall');
    expect(cmd).toContain('--no-role-passwords');
    expect(cmd).not.toContain('pg_dump '); // not single-db
  });

  it('postgres: pg_dump for a single db', () => {
    const cmd = dumpStreamCommand({ type: 'postgres', container: 'pg', user: 'postgres', db: 'mydb' });
    expect(cmd).toContain('pg_dump -U ');
    expect(cmd).toContain('-d ');
    expect(cmd).toContain('mydb');
    expect(cmd).toContain('--clean');
  });

  it('postgres: falls back to env var when user not set', () => {
    const cmd = dumpStreamCommand({ type: 'postgres', container: 'pg' });
    expect(cmd).toContain('"$POSTGRES_USER"');
  });

  it('mysql: prefers passwordFile over passwordEnv', () => {
    const cmd = dumpStreamCommand({
      type: 'mysql',
      container: 'shared-mysql',
      user: 'root',
      passwordFile: '/run/secrets/mysql_root_password',
    });
    expect(cmd).toContain('docker exec shared-mysql');
    expect(cmd).toContain('mysqldump');
    expect(cmd).toContain('-uroot');
    expect(cmd).toContain('$(cat ');
    expect(cmd).toContain('mysql_root_password');
    expect(cmd).toContain('--all-databases');
  });

  it('mysql: respects --single-transaction', () => {
    const cmd = dumpStreamCommand({ type: 'mysql', container: 'm', user: 'root', passwordFile: '/x' });
    expect(cmd).toContain('--single-transaction');
    expect(cmd).toContain('--routines');
    expect(cmd).toContain('--triggers');
  });

  it('mongo: uses authentication-database admin + file password', () => {
    const cmd = dumpStreamCommand({
      type: 'mongo',
      container: 'shared-mongodb',
      user: 'root',
      passwordFile: '/run/secrets/mongo_root_password',
    });
    expect(cmd).toContain('mongodump');
    expect(cmd).toContain('--archive');
    expect(cmd).toContain('--username root');
    expect(cmd).toContain('$(cat ');
    expect(cmd).toContain('--authenticationDatabase admin');
  });

  it('mongo: db filter omitted when not set', () => {
    const cmd = dumpStreamCommand({ type: 'mongo', container: 'm', user: 'root', passwordFile: '/x' });
    expect(cmd).not.toContain('--db=');
  });

  it('mongo: db filter included when set', () => {
    const cmd = dumpStreamCommand({
      type: 'mongo', container: 'm', user: 'root', passwordFile: '/x', db: 'mydb',
    });
    expect(cmd).toContain('--db=');
    expect(cmd).toContain('mydb');
  });

  it('redis: writes rdb then cats it, with file-based password', () => {
    const cmd = dumpStreamCommand({
      type: 'redis',
      container: 'shared-redis',
      passwordFile: '/run/secrets/redis_password',
    });
    expect(cmd).toContain('redis-cli');
    expect(cmd).toContain('--rdb');
    expect(cmd).toContain('cat /tmp/dump.rdb');
    expect(cmd).toContain('$(cat ');
  });

  it('redis: includes -p flag when port is set', () => {
    const cmd = dumpStreamCommand({
      type: 'redis',
      container: 'glitchtip-redis',
      port: 19011,
    });
    expect(cmd).toContain('-p 19011');
  });

  it('redis: omits -p flag when port not set (uses default 6379)', () => {
    const cmd = dumpStreamCommand({
      type: 'redis',
      container: 'shared-redis',
    });
    expect(cmd).not.toContain('-p ');
  });

  it('redis: passwordHostCommand injects password via docker exec -e', () => {
    const cmd = dumpStreamCommand({
      type: 'redis',
      container: 'glitchtip-redis',
      port: 19011,
      passwordHostCommand: 'grep ^REDIS_PASSWORD /home/matt/glitchtip/.env | cut -d= -f2-',
    });
    expect(cmd).toContain('-e REDIS_PASSWORD="$(');
    expect(cmd).toContain('grep ^REDIS_PASSWORD /home/matt/glitchtip/.env');
    expect(cmd).toContain('-p 19011');
    // password reference inside container uses the injected env var
    expect(cmd).toContain('"$REDIS_PASSWORD"');
  });

  it('rejects unknown dump type', () => {
    expect(() => dumpStreamCommand({ type: 'unknown' as never, container: 'x' }))
      .toThrow(DumpError);
  });

  it('output is single-quoted to neutralise outer-shell expansion', () => {
    // the docker exec sh -c "..." must be single-quoted so $POSTGRES_USER
    // expands inside the container, not in the calling shell.
    const cmd = dumpStreamCommand({ type: 'postgres', container: 'pg' });
    // the inner cmd should be wrapped in single quotes
    expect(cmd).toMatch(/sh -c '[^']*'/);
  });
});

describe('dumpFilename', () => {
  it('formats per dump type', () => {
    expect(dumpFilename({ type: 'postgres', container: 'p' })).toBe('all.pg.sql');
    expect(dumpFilename({ type: 'postgres', container: 'p', db: 'x' })).toBe('x.pg.sql');
    expect(dumpFilename({ type: 'mysql', container: 'm' })).toBe('all.mysql.sql');
    expect(dumpFilename({ type: 'mongo', container: 'mg' })).toBe('all.mongo.archive');
    expect(dumpFilename({ type: 'redis', container: 'r' })).toBe('dump.rdb');
  });
});
