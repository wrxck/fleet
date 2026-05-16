import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { _resetOperatorCache } from '../operator';

import {
  SYSTEM_PATHS,
  ROOT_HOME_PATHS,
  userHomePaths,
  systemConfig,
  rootHomeConfig,
  userHomeConfig,
} from './system';

let opDir: string;

describe('backup/system', () => {
  beforeEach(() => {
    opDir = mkdtempSync(join(tmpdir(), 'fleet-system-op-'));
    writeFileSync(join(opDir, 'operator.json'), JSON.stringify({
      username: 'op', homeDir: '/home/op', domain: 'fleet.test', githubOrg: 'op-org',
    }));
    process.env.FLEET_OPERATOR_PATH = join(opDir, 'operator.json');
    _resetOperatorCache();
  });
  afterEach(() => {
    rmSync(opDir, { recursive: true, force: true });
    delete process.env.FLEET_OPERATOR_PATH;
    _resetOperatorCache();
  });

  it('system paths include the critical infra dirs', () => {
    for (const required of [
      '/etc/nginx',
      '/etc/letsencrypt',
      '/etc/fleet',
      '/etc/iptables',
      '/etc/systemd/system',
    ]) {
      expect(SYSTEM_PATHS).toContain(required);
    }
  });

  it('root-home covers ssh, mcp, claude state', () => {
    expect(ROOT_HOME_PATHS).toContain('/root/.ssh');
    expect(ROOT_HOME_PATHS).toContain('/root/.mcp.json');
    expect(ROOT_HOME_PATHS).toContain('/root/.claude');
  });

  it('user-home covers ssh, gitconfig, claude state but skips app dirs', () => {
    const paths = userHomePaths('/home/op');
    expect(paths).toContain('/home/op/.ssh');
    expect(paths).toContain('/home/op/.gitconfig');
    expect(paths).toContain('/home/op/.claude');
    // never include an actual app subdir
    expect(paths.every(p => p.startsWith('/home/op/.'))).toBe(true);
  });

  it('default configs have safe retention and explicit schedule', () => {
    for (const cfg of [systemConfig(), rootHomeConfig(), userHomeConfig()]) {
      expect(cfg.schedule).toBe('daily');
      expect(cfg.retention.daily).toBeGreaterThan(0);
      expect(cfg.paths.length).toBeGreaterThan(0);
    }
  });
});
