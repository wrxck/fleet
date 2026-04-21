import { realpathSync } from 'node:fs';

import { execSafe } from '../../core/exec.js';
import type { Signal } from '../../core/routines/schema.js';
import type { SignalProvider } from '../types.js';

function resolveSafe(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

export const gitCleanProvider: SignalProvider = {
  kind: 'git-clean',
  ttlMs: 5_000,
  strategy: 'pull',
  async collect(repoPath: string, repoName: string): Promise<Signal> {
    const collectedAt = new Date().toISOString();
    const toplevel = execSafe('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'], { timeout: 5_000 });
    const expected = resolveSafe(repoPath);
    const actual = toplevel.ok ? resolveSafe(toplevel.stdout.trim()) : null;
    if (!toplevel.ok || !expected || !actual || expected !== actual) {
      return {
        repo: repoName,
        kind: 'git-clean',
        state: 'unknown',
        value: null,
        detail: !toplevel.ok ? (toplevel.stderr || 'not a git repo') : 'path is not a git repo root',
        collectedAt,
        ttlMs: this.ttlMs,
      };
    }

    const status = execSafe('git', ['-C', repoPath, 'status', '--porcelain=1'], { timeout: 5_000 });
    if (!status.ok) {
      return {
        repo: repoName,
        kind: 'git-clean',
        state: 'unknown',
        value: null,
        detail: status.stderr || 'git status failed',
        collectedAt,
        ttlMs: this.ttlMs,
      };
    }
    const dirty = status.stdout.trim().length > 0;
    const changeCount = dirty ? status.stdout.split('\n').filter(Boolean).length : 0;
    return {
      repo: repoName,
      kind: 'git-clean',
      state: dirty ? 'warn' : 'ok',
      value: !dirty,
      detail: dirty ? `${changeCount} uncommitted change${changeCount === 1 ? '' : 's'}` : '',
      collectedAt,
      ttlMs: this.ttlMs,
    };
  },
};
