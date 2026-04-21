import { readFileSync, existsSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { load } from './registry.js';

// these tests read actual systemd service files — skip in CI
const isCI = !!process.env.CI;

const bootOrderReg = load();
const dbApps = bootOrderReg.apps.filter(a => a.dependsOnDatabases);

describe.skipIf(isCI || dbApps.length === 0)('boot order - systemd dependencies', () => {
  for (const app of dbApps) {
    describe(app.serviceName, () => {
      const servicePath = `/etc/systemd/system/${app.serviceName}.service`;

      it('has a systemd service file', () => {
        expect(existsSync(servicePath)).toBeTruthy();
      });

      it('requires docker-databases.service', () => {
        const content = readFileSync(servicePath, 'utf-8');
        expect(content).toContain('docker-databases.service');
      });

      it('has docker-databases.service in After', () => {
        const content = readFileSync(servicePath, 'utf-8');
        const afterLine = content.match(/^After=(.+)$/m);
        expect(afterLine).not.toBeNull();
        expect(afterLine![1]).toContain('docker-databases.service');
      });
    });
  }
});

describe.skipIf(isCI)('fleet-unseal.service', () => {
  const path = '/etc/systemd/system/fleet-unseal.service';

  it('exists', () => {
    expect(existsSync(path)).toBeTruthy();
  });

  it('runs before docker-databases', () => {
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('Before=docker-databases.service');
  });
});

describe.skipIf(isCI)('fleet-watchdog.timer', () => {
  const timerPath = '/etc/systemd/system/fleet-watchdog.timer';

  it('exists', () => {
    expect(existsSync(timerPath)).toBeTruthy();
  });
});

const healthScriptPath = (() => {
  const reg = load();
  const dbPath = reg.infrastructure.databases.composePath;
  return dbPath ? `${dbPath}/wait-for-healthy.sh` : '';
})();
const skipHealthScript = isCI || !healthScriptPath || !existsSync(healthScriptPath);

describe.skipIf(skipHealthScript)('wait-for-healthy.sh', () => {
  it('has timeout >= 180s', () => {
    const content = readFileSync(healthScriptPath, 'utf-8');
    const match = content.match(/TIMEOUT=(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(180);
  });
});
