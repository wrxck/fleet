import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { execSafe } from '../../core/exec.js';
import { mkExecTmpDir } from '../../core/routines/test-utils.js';
import { gitCleanProvider } from './git-clean.js';

describe('gitCleanProvider', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkExecTmpDir('fleet-gitclean-');
    execSafe('git', ['init', '--quiet', dir]);
    execSafe('git', ['-C', dir, 'config', 'user.email', 't@test.local']);
    execSafe('git', ['-C', dir, 'config', 'user.name', 'Tester']);
    execSafe('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
    writeFileSync(join(dir, 'README.md'), 'initial');
    execSafe('git', ['-C', dir, 'add', '.']);
    execSafe('git', ['-C', dir, 'commit', '-m', 'init', '--quiet']);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports ok on a clean working tree', async () => {
    const sig = await gitCleanProvider.collect(dir, 'demo');
    expect(sig.state).toBe('ok');
    expect(sig.value).toBeTruthy();
    expect(sig.kind).toBe('git-clean');
  });

  it('reports warn with count when dirty', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'b.txt'), 'world');
    const sig = await gitCleanProvider.collect(dir, 'demo');
    expect(sig.state).toBe('warn');
    expect(sig.value).toBeFalsy();
    expect(sig.detail).toContain('2 uncommitted changes');
  });

  it('reports unknown on a non-git directory', async () => {
    const nonGit = mkExecTmpDir('fleet-nogit-');
    try {
      const sig = await gitCleanProvider.collect(nonGit, 'demo');
      expect(sig.state).toBe('unknown');
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});
