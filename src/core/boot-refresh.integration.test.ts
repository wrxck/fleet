import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { refresh } from './boot-refresh.js';
import type { AppEntry } from './registry.js';

const SHOULD_RUN = process.env.FLEET_INTEGRATION === '1';
const d = SHOULD_RUN ? describe : describe.skip;

function testApp(path: string): AppEntry {
  return {
    name: 'it-sample',
    displayName: 'it-sample',
    composePath: path,
    composeFile: null,
    serviceName: 'it-sample',
    domains: [],
    port: null,
    usesSharedDb: false,
    type: 'service',
    containers: ['it-sample'],
    dependsOnDatabases: false,
    registeredAt: '',
  };
}

d('boot-refresh integration — happy path', () => {
  let workDir: string;
  let originDir: string;
  let workingTree: string;
  let originalRegistryPath: string | undefined;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'fleet-bootrefresh-'));
    originDir = join(workDir, 'origin.git');
    workingTree = join(workDir, 'app');

    execSync(`git init --bare "${originDir}"`);
    execSync(`git init -b main "${workingTree}"`);
    execSync(`git -C "${workingTree}" config user.email it@test`);
    execSync(`git -C "${workingTree}" config user.name it`);

    await fs.writeFile(join(workingTree, 'Dockerfile'), 'FROM alpine\nRUN echo v1\n');
    await fs.writeFile(join(workingTree, 'docker-compose.yml'), `services:
  app:
    build: .
    image: fleet-it-sample:latest
`);
    execSync(`git -C "${workingTree}" add .`);
    execSync(`git -C "${workingTree}" commit -m init`);
    execSync(`git -C "${workingTree}" remote add origin "${originDir}"`);
    execSync(`git -C "${workingTree}" push -u origin main`);

    // Point registry at a tmp file so recordBuiltCommit writes there
    originalRegistryPath = process.env.FLEET_REGISTRY_PATH;
    process.env.FLEET_REGISTRY_PATH = join(workDir, 'registry.json');
    await fs.writeFile(process.env.FLEET_REGISTRY_PATH, JSON.stringify({
      version: 1,
      apps: [testApp(workingTree)],
      infrastructure: {
        databases: { serviceName: 'docker-databases', composePath: '' },
        nginx: { configPath: '/etc/nginx' },
      },
    }, null, 2));
  });

  afterAll(async () => {
    if (originalRegistryPath) process.env.FLEET_REGISTRY_PATH = originalRegistryPath;
    else delete process.env.FLEET_REGISTRY_PATH;
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('origin ahead: fetch + ff-merge + build (or build fails gracefully if docker unavailable)', async () => {
    // Advance origin with a new commit
    const clone = join(workDir, 'clone');
    execSync(`git clone --branch main "${originDir}" "${clone}"`);
    execSync(`git -C "${clone}" config user.email it@test`);
    execSync(`git -C "${clone}" config user.name it`);
    await fs.writeFile(join(clone, 'Dockerfile'), 'FROM alpine\nRUN echo v2\n');
    execSync(`git -C "${clone}" add .`);
    execSync(`git -C "${clone}" commit -m v2`);
    execSync(`git -C "${clone}" push origin main`);

    const r = await refresh(testApp(workingTree));
    // If docker is available, result is 'refreshed'. If not, refresh gets to the build step
    // and fails-safe. Either way, result is not 'skipped' (preflight passed).
    expect(['refreshed', 'failed-safe']).toContain(r.kind);
    if (r.kind === 'failed-safe') {
      expect(r.step).toBe('build');
    }
  }, 180_000);
});
