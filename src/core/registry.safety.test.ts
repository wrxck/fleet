import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, save, withRegistry, addApp } from './registry.js';
import type { AppEntry, Registry } from './registry.js';

function makeEmptyRegistry(): Registry {
  return {
    version: 1,
    apps: [],
    infrastructure: {
      databases: { serviceName: 'docker-databases', composePath: '' },
      nginx: { configPath: '/etc/nginx' },
    },
  };
}

function makeTestApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test',
    displayName: 'test',
    composePath: '/tmp/test',
    composeFile: null,
    serviceName: 'test',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: [],
    dependsOnDatabases: false,
    registeredAt: '',
    ...overrides,
  };
}

describe('registry safety', () => {
  let tmpDir: string;
  let tmpRegistry: string;
  let tmpRegistryBak: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'fleet-registry-'));
    tmpRegistry = join(tmpDir, 'registry.json');
    tmpRegistryBak = join(tmpDir, 'registry.json.bak');
    originalPath = process.env.FLEET_REGISTRY_PATH;
    process.env.FLEET_REGISTRY_PATH = tmpRegistry;
  });

  afterEach(async () => {
    if (originalPath !== undefined) process.env.FLEET_REGISTRY_PATH = originalPath;
    else delete process.env.FLEET_REGISTRY_PATH;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes atomically via temp file + rename (no .tmp lingers)', async () => {
    const reg = makeEmptyRegistry();
    save(reg);
    const entries = await fs.readdir(tmpDir);
    expect(entries.filter(e => e.endsWith('.tmp'))).toHaveLength(0);
    expect(entries).toContain('registry.json');
  });

  it('creates .bak before overwriting existing registry', async () => {
    const first = makeEmptyRegistry();
    first.apps.push(makeTestApp({ name: 'first', displayName: 'first', composePath: '/tmp/a', serviceName: 'first' }));
    save(first);
    const second = makeEmptyRegistry();
    second.apps.push(makeTestApp({ name: 'second', displayName: 'second', composePath: '/tmp/b', serviceName: 'second' }));
    save(second);
    const bakContent = await fs.readFile(tmpRegistryBak, 'utf-8');
    expect(JSON.parse(bakContent).apps[0].name).toBe('first');
    const mainContent = await fs.readFile(tmpRegistry, 'utf-8');
    expect(JSON.parse(mainContent).apps[0].name).toBe('second');
  });

  it('falls back to .bak when registry.json is unparsable', async () => {
    // Seed: two saves so a .bak exists
    const good = makeEmptyRegistry();
    good.apps.push(makeTestApp({ name: 'backup-me', displayName: 'backup-me', composePath: '/tmp/c', serviceName: 'backup-me' }));
    save(good);
    const good2 = makeEmptyRegistry();
    good2.apps.push(makeTestApp({ name: 'current', displayName: 'current', composePath: '/tmp/d', serviceName: 'current' }));
    save(good2);
    // Now .bak has "backup-me", registry.json has "current"
    // Corrupt the main file:
    await fs.writeFile(tmpRegistry, '{not valid json');
    const loaded = load();
    expect(loaded.apps[0].name).toBe('backup-me');
  });

  it('loads from .bak when main file is missing entirely', async () => {
    const good = makeEmptyRegistry();
    good.apps.push(makeTestApp({ name: 'from-bak-only', displayName: 'from-bak-only', composePath: '/tmp/x', serviceName: 'from-bak-only' }));
    await fs.writeFile(tmpRegistryBak, JSON.stringify(good, null, 2));
    const loaded = load();
    expect(loaded.apps[0].name).toBe('from-bak-only');
  });

  it('returns defaultRegistry when both main and .bak are unparsable', async () => {
    await fs.writeFile(tmpRegistry, '{corrupt');
    await fs.writeFile(tmpRegistryBak, '{also corrupt');
    const loaded = load();
    expect(loaded.apps).toHaveLength(0);
    expect(loaded.infrastructure.databases.serviceName).toBe('docker-databases');
  });

  it('preserves existing .bak when main file is corrupt during save', async () => {
    const good = makeEmptyRegistry();
    good.apps.push(makeTestApp({ name: 'original-bak', displayName: 'original-bak', composePath: '/tmp/y', serviceName: 'original-bak' }));
    await fs.writeFile(tmpRegistryBak, JSON.stringify(good, null, 2));
    // Corrupt the main file
    await fs.writeFile(tmpRegistry, '{corrupt');
    // Save a new registry — must NOT overwrite the good .bak with the corrupt main
    const next = makeEmptyRegistry();
    next.apps.push(makeTestApp({ name: 'new-current', displayName: 'new-current', composePath: '/tmp/z', serviceName: 'new-current' }));
    save(next);
    const bakContent = await fs.readFile(tmpRegistryBak, 'utf-8');
    expect(JSON.parse(bakContent).apps[0].name).toBe('original-bak');
  });

  // Concurrency smoke test: previously a CLI invocation and a cron unseal /
  // bot mutation could each load() the registry, mutate locally, and save() —
  // the second save would overwrite the first one's app. With withRegistry,
  // the load/mutate/save runs under an inter-process file lock so the two
  // mutations serialise instead of stomping each other.
  //
  // Skipped on CI where lockfile mtime precision can be flaky; runs locally.
  (process.env.CI ? it.skip : it)('serialises concurrent withRegistry mutations', async () => {
    // Seed an empty registry on disk so both withRegistry calls see the same
    // baseline before they race.
    save(makeEmptyRegistry());

    const appA = makeTestApp({ name: 'concurrent-a', displayName: 'A', composePath: '/tmp/a', serviceName: 'concurrent-a' });
    const appB = makeTestApp({ name: 'concurrent-b', displayName: 'B', composePath: '/tmp/b', serviceName: 'concurrent-b' });

    // Race two adds. Both calls go through withRegistry → lock → load → addApp
    // → save → unlock. Whichever lands second observes the first one's write.
    await Promise.all([
      withRegistry(reg => addApp(reg, appA)),
      withRegistry(reg => addApp(reg, appB)),
    ]);

    const final = load();
    const names = final.apps.map(a => a.name).sort();
    expect(names).toEqual(['concurrent-a', 'concurrent-b']);
  });
});
