import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { StackDetector } from '../types.js';

export const nodeDetector: StackDetector = {
  id: 'node',
  priority: 10,
  detect(repoPath: string): boolean {
    return existsSync(join(repoPath, 'package.json'));
  },
};

export const dockerDetector: StackDetector = {
  id: 'docker',
  priority: 20,
  detect(repoPath: string): boolean {
    return (
      existsSync(join(repoPath, 'docker-compose.yml'))
      || existsSync(join(repoPath, 'docker-compose.yaml'))
      || existsSync(join(repoPath, 'Dockerfile'))
    );
  },
};

export const pythonDetector: StackDetector = {
  id: 'python',
  priority: 10,
  detect(repoPath: string): boolean {
    return (
      existsSync(join(repoPath, 'pyproject.toml'))
      || existsSync(join(repoPath, 'requirements.txt'))
      || existsSync(join(repoPath, 'uv.lock'))
    );
  },
};

export const rustDetector: StackDetector = {
  id: 'rust',
  priority: 10,
  detect(repoPath: string): boolean {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },
};

export const genericDetector: StackDetector = {
  id: 'generic',
  priority: 1,
  detect(): boolean {
    return true;
  },
};

export const BUILT_IN_DETECTORS: readonly StackDetector[] = Object.freeze([
  dockerDetector,
  nodeDetector,
  pythonDetector,
  rustDetector,
  genericDetector,
]);

export function detectStacks(
  repoPath: string,
  detectors: readonly StackDetector[] = BUILT_IN_DETECTORS,
): StackDetector['id'][] {
  return detectors
    .filter(d => d.detect(repoPath))
    .sort((a, b) => b.priority - a.priority)
    .map(d => d.id);
}
