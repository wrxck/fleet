import { describe, it, expect } from 'vitest';

import { runChecks } from './doctor';

function makeRunner(over: Partial<Parameters<typeof runChecks>[0]> = {}) {
  // sensible "everything's fine" defaults; individual tests override the
  // probe they care about.
  return {
    exec: (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'age') return { ok: true, stdout: '/usr/bin/age', stderr: '' };
      if (cmd === 'age' && args[0] === '--version') return { ok: true, stdout: 'v1.2.0', stderr: '' };
      if (cmd === 'docker' && args.join(' ') === 'compose version') {
        return { ok: true, stdout: 'docker compose version v2.27.0', stderr: '' };
      }
      if (cmd === 'systemctl' && args[0] === '--version') {
        return { ok: true, stdout: 'systemd 245 (245.4-4ubuntu3.21)\n+PAM +AUDIT', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'unknown command' };
    },
    exists: (_: string) => true,
    loadRegistry: () => ({
      version: 1,
      apps: [{ name: 'demo', composePath: '/srv/demo' } as Parameters<typeof runChecks>[0]['loadRegistry'] extends () => infer R ? R extends { apps: infer A } ? A extends Array<infer Item> ? Item : never : never : never],
      infrastructure: { databases: { serviceName: '', composePath: '' }, nginx: { configPath: '' } },
    }),
    loadOperator: () => ({
      username: 'op', homeDir: '/home/op', domain: 'fleet.test', githubOrg: 'op-org',
    }),
    vaultInitialised: () => true,
    vaultSealed: () => false,
    ...over,
  } as Parameters<typeof runChecks>[0];
}

describe('fleet doctor — runChecks', () => {
  it('returns ok for every check in a healthy environment', () => {
    const data = runChecks(makeRunner());
    expect(data.summary.fail).toBe(0);
    expect(data.summary.ok).toBeGreaterThanOrEqual(6);
    // every check has a label + status + detail string
    for (const c of data.checks) {
      expect(typeof c.name).toBe('string');
      expect(['ok', 'warn', 'fail']).toContain(c.status);
      expect(typeof c.detail).toBe('string');
    }
  });

  it('fails when age is missing', () => {
    const data = runChecks(makeRunner({
      exec: (cmd, args) => {
        if (cmd === 'which' && args[0] === 'age') return { ok: false, stdout: '', stderr: 'not found' };
        return makeRunner().exec(cmd, args);
      },
    }));
    const age = data.checks.find(c => c.name === 'age');
    expect(age?.status).toBe('fail');
    expect(data.summary.fail).toBeGreaterThanOrEqual(1);
  });

  it('warns (does not crash) when the sealed state is unreadable as a non-root user', () => {
    const data = runChecks(makeRunner({
      vaultSealed: () => { throw new Error('EACCES: permission denied, scandir'); },
    }));
    const vault = data.checks.find(c => c.name === 'secrets vault');
    expect(vault?.status).toBe('warn');
    expect(vault?.detail).toMatch(/needs root|daemon/i);
  });

  it('warns when systemd is below 240 (LoadCredentialEncrypted)', () => {
    const data = runChecks(makeRunner({
      exec: (cmd, args) => {
        if (cmd === 'systemctl' && args[0] === '--version') {
          return { ok: true, stdout: 'systemd 232 (232-25+deb9u12)', stderr: '' };
        }
        return makeRunner().exec(cmd, args);
      },
    }));
    const sd = data.checks.find(c => c.name === 'systemd');
    expect(sd?.status).toBe('warn');
    expect(sd?.detail).toMatch(/240/);
  });

  it('fails when docker compose is missing', () => {
    const data = runChecks(makeRunner({
      exec: (cmd, args) => {
        if (cmd === 'docker' && args[0] === 'compose') return { ok: false, stdout: '', stderr: 'no command' };
        return makeRunner().exec(cmd, args);
      },
    }));
    const dc = data.checks.find(c => c.name === 'docker compose');
    expect(dc?.status).toBe('fail');
  });

  it('fails the registry check when load throws', () => {
    const data = runChecks(makeRunner({
      loadRegistry: () => { throw new Error('parse failed: unexpected token'); },
    }));
    const reg = data.checks.find(c => c.name === 'registry');
    expect(reg?.status).toBe('fail');
    expect(reg?.detail).toMatch(/parse failed/);
  });

  it('fails the operator config check when the file is missing', () => {
    const data = runChecks(makeRunner({
      loadOperator: () => { throw new Error('operator config not found at /x'); },
    }));
    const op = data.checks.find(c => c.name === 'operator config');
    expect(op?.status).toBe('fail');
  });

  it('warns when the vault is not initialised', () => {
    const data = runChecks(makeRunner({ vaultInitialised: () => false }));
    const v = data.checks.find(c => c.name === 'secrets vault');
    expect(v?.status).toBe('warn');
    expect(v?.detail).toMatch(/not initialised/);
  });

  it('warns when a registered app has no composePath on disk', () => {
    const data = runChecks(makeRunner({
      exists: (p: string) => !p.startsWith('/srv/demo'),
    }));
    const orph = data.checks.find(c => c.name === 'registered apps on disk');
    expect(orph?.status).toBe('warn');
    expect(orph?.detail).toMatch(/demo/);
  });
});
