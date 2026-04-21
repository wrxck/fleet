import { execSafe } from '../../core/exec.js';
import type { Signal, SignalState } from '../../core/routines/schema.js';
import type { SignalProvider } from '../types.js';

interface GhRun {
  status: string;
  conclusion: string | null;
  name: string;
  headBranch: string;
  event: string;
  createdAt: string;
  url: string;
}

function ghRunToState(run: GhRun): SignalState {
  if (run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting') return 'warn';
  switch (run.conclusion) {
    case 'success': return 'ok';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'error';
    case 'cancelled':
    case 'skipped':
    case 'stale':
    case 'neutral':
      return 'warn';
    default: return 'unknown';
  }
}

export const ciStatusProvider: SignalProvider = {
  kind: 'ci-status',
  ttlMs: 60_000,
  strategy: 'event',
  async collect(repoPath: string, repoName: string): Promise<Signal> {
    const collectedAt = new Date().toISOString();
    const result = execSafe('gh', [
      'run', 'list',
      '--limit', '1',
      '--json', 'status,conclusion,name,headBranch,event,createdAt,url',
    ], { cwd: repoPath, timeout: 8_000 });

    if (!result.ok) {
      return {
        repo: repoName,
        kind: 'ci-status',
        state: 'unknown',
        value: null,
        detail: result.stderr || 'gh run list failed',
        collectedAt,
        ttlMs: this.ttlMs,
      };
    }

    let runs: GhRun[] = [];
    try { runs = JSON.parse(result.stdout) as GhRun[]; } catch {
      return {
        repo: repoName,
        kind: 'ci-status',
        state: 'unknown',
        value: null,
        detail: 'gh output not JSON',
        collectedAt,
        ttlMs: this.ttlMs,
      };
    }

    if (runs.length === 0) {
      return {
        repo: repoName,
        kind: 'ci-status',
        state: 'unknown',
        value: null,
        detail: 'no runs yet',
        collectedAt,
        ttlMs: this.ttlMs,
      };
    }

    const latest = runs[0];
    const state = ghRunToState(latest);
    return {
      repo: repoName,
      kind: 'ci-status',
      state,
      value: latest.conclusion ?? latest.status,
      detail: `${latest.name} · ${latest.headBranch} · ${latest.conclusion ?? latest.status}`,
      collectedAt,
      ttlMs: this.ttlMs,
    };
  },
};
