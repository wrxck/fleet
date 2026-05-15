import { describe, it, expect } from 'vitest';

import {
  SYSTEM_PATHS,
  ROOT_HOME_PATHS,
  MATT_HOME_PATHS,
  systemConfig,
  rootHomeConfig,
  mattHomeConfig,
} from './system';

describe('backup/system', () => {
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

  it('matt-home covers ssh, gitconfig, claude state but skips app dirs', () => {
    expect(MATT_HOME_PATHS).toContain('/home/matt/.ssh');
    expect(MATT_HOME_PATHS).toContain('/home/matt/.gitconfig');
    expect(MATT_HOME_PATHS).toContain('/home/matt/.claude');
    // never include an actual app subdir
    expect(MATT_HOME_PATHS.every(p => p.startsWith('/home/matt/.'))).toBe(true);
  });

  it('default configs have safe retention and explicit schedule', () => {
    for (const cfg of [systemConfig(), rootHomeConfig(), mattHomeConfig()]) {
      expect(cfg.schedule).toBe('daily');
      expect(cfg.retention.daily).toBeGreaterThan(0);
      expect(cfg.paths.length).toBeGreaterThan(0);
    }
  });
});
