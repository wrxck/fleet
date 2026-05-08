import { describe, it, expect } from 'vitest';

import { migrateComposeToV2, revertComposeFromV2 } from './compose-edit.js';

describe('migrateComposeToV2', () => {
  it('adds bind-mount and env var, removes env_file (string form)', () => {
    const input = `
services:
  app:
    image: myapp:latest
    env_file: /run/fleet-secrets/foo/.env
`.trimStart();

    const output = migrateComposeToV2(input, 'foo', 'app');

    expect(output).toContain('FLEET_SECRETS_SOCKET: /run/fleet.sock');
    expect(output).toContain('/run/fleet-secrets/foo.sock:/run/fleet.sock:ro');
    expect(output).not.toContain('env_file');
  });

  it('is idempotent — running twice produces the same output as once', () => {
    const input = `
services:
  app:
    image: myapp:latest
    env_file: /run/fleet-secrets/foo/.env
`.trimStart();

    const once = migrateComposeToV2(input, 'foo', 'app');
    const twice = migrateComposeToV2(once, 'foo', 'app');

    expect(twice).toBe(once);
  });

  it('preserves unrelated services', () => {
    const input = `
services:
  app:
    image: myapp:latest
    env_file: /run/fleet-secrets/foo/.env
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: mydb
`.trimStart();

    const output = migrateComposeToV2(input, 'foo', 'app');

    expect(output).toContain('postgres:16');
    expect(output).toContain('POSTGRES_DB: mydb');
    expect(output).not.toContain('env_file');
  });

  it('merges the socket mount into existing volumes', () => {
    const input = `
services:
  app:
    image: myapp:latest
    volumes:
      - ./data:/data
`.trimStart();

    const output = migrateComposeToV2(input, 'foo', 'app');

    expect(output).toContain('./data:/data');
    expect(output).toContain('/run/fleet-secrets/foo.sock:/run/fleet.sock:ro');
  });

  it('merges FLEET_SECRETS_SOCKET into existing environment map', () => {
    const input = `
services:
  app:
    image: myapp:latest
    environment:
      FOO: bar
`.trimStart();

    const output = migrateComposeToV2(input, 'foo', 'app');

    expect(output).toContain('FOO: bar');
    expect(output).toContain('FLEET_SECRETS_SOCKET: /run/fleet.sock');
  });

  it('handles env_file as array — removes only the v1 path, keeps others', () => {
    const input = `
services:
  app:
    image: myapp:latest
    env_file:
      - /run/fleet-secrets/foo/.env
      - ./other.env
`.trimStart();

    const output = migrateComposeToV2(input, 'foo', 'app');

    expect(output).toContain('./other.env');
    expect(output).not.toContain('/run/fleet-secrets/foo/.env');
    expect(output).toContain('FLEET_SECRETS_SOCKET: /run/fleet.sock');
    expect(output).toContain('/run/fleet-secrets/foo.sock:/run/fleet.sock:ro');
  });

  it('throws when the named service does not exist', () => {
    const input = `
services:
  app:
    image: myapp:latest
`.trimStart();

    expect(() => migrateComposeToV2(input, 'foo', 'nonexistent')).toThrow();
  });

  it('adds bind-mount and env var even when no env_file exists', () => {
    const input = `
services:
  app:
    image: myapp:latest
`.trimStart();

    const output = migrateComposeToV2(input, 'foo', 'app');

    expect(output).toContain('FLEET_SECRETS_SOCKET: /run/fleet.sock');
    expect(output).toContain('/run/fleet-secrets/foo.sock:/run/fleet.sock:ro');
    expect(output).not.toContain('env_file');
  });
});

describe('revertComposeFromV2', () => {
  it('removes bind-mount and env var, restores env_file', () => {
    const base = `
services:
  app:
    image: myapp:latest
    env_file: /run/fleet-secrets/foo/.env
`.trimStart();

    const migrated = migrateComposeToV2(base, 'foo', 'app');
    const reverted = revertComposeFromV2(migrated, 'foo', 'app');

    expect(reverted).toContain('env_file');
    expect(reverted).toContain('/run/fleet-secrets/foo/.env');
    expect(reverted).not.toContain('FLEET_SECRETS_SOCKET');
    expect(reverted).not.toContain('/run/fleet-secrets/foo.sock:/run/fleet.sock:ro');
  });

  it('is idempotent — reverting twice is same as reverting once', () => {
    const base = `
services:
  app:
    image: myapp:latest
    env_file: /run/fleet-secrets/foo/.env
`.trimStart();

    const migrated = migrateComposeToV2(base, 'foo', 'app');
    const once = revertComposeFromV2(migrated, 'foo', 'app');
    const twice = revertComposeFromV2(once, 'foo', 'app');

    expect(twice).toBe(once);
  });

  it('throws when the named service does not exist', () => {
    const input = `
services:
  app:
    image: myapp:latest
`.trimStart();

    expect(() => revertComposeFromV2(input, 'foo', 'nonexistent')).toThrow();
  });
});

describe('round-trip stability', () => {
  it('migrate→revert→migrate produces the same output as a single migrate', () => {
    const base = `
services:
  app:
    image: myapp:latest
    env_file: /run/fleet-secrets/foo/.env
`.trimStart();

    const m1 = migrateComposeToV2(base, 'foo', 'app');
    const r1 = revertComposeFromV2(m1, 'foo', 'app');
    const m2 = migrateComposeToV2(r1, 'foo', 'app');

    expect(m2).toBe(m1);
  });
});
