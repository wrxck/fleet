import { execSafe } from '../../core/exec.js';
import type { Signal } from '../../core/routines/schema.js';
import type { SignalProvider } from '../types.js';

const COMPOSE_LABEL = 'com.docker.compose.project';

export interface ContainerUpOptions {
  projectForRepo?(repoName: string): string;
}

export function createContainerUpProvider(opts: ContainerUpOptions = {}): SignalProvider {
  const projectForRepo = opts.projectForRepo ?? ((name: string) => name);

  return {
    kind: 'container-up',
    ttlMs: 15_000,
    strategy: 'pull',
    async collect(_repoPath: string, repoName: string): Promise<Signal> {
      const project = projectForRepo(repoName);
      const collectedAt = new Date().toISOString();
      const result = execSafe('docker', [
        'ps', '--all',
        '--filter', `label=${COMPOSE_LABEL}=${project}`,
        '--format', '{{.State}}',
      ], { timeout: 5_000 });

      if (!result.ok) {
        return {
          repo: repoName,
          kind: 'container-up',
          state: 'unknown',
          value: null,
          detail: result.stderr || 'docker ps failed',
          collectedAt,
          ttlMs: this.ttlMs,
        };
      }

      const states = result.stdout.split('\n').map(s => s.trim()).filter(Boolean);
      if (states.length === 0) {
        return {
          repo: repoName,
          kind: 'container-up',
          state: 'warn',
          value: 0,
          detail: 'no containers for project',
          collectedAt,
          ttlMs: this.ttlMs,
        };
      }
      const running = states.filter(s => s === 'running').length;
      const total = states.length;
      const allRunning = running === total;
      return {
        repo: repoName,
        kind: 'container-up',
        state: allRunning ? 'ok' : running > 0 ? 'warn' : 'error',
        value: running,
        detail: `${running}/${total} running`,
        collectedAt,
        ttlMs: this.ttlMs,
      };
    },
  };
}
