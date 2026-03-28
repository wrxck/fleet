import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../exec.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../../../exec.js';
import type { AppEntry } from '../../../registry.js';
import { GitHubPrCollector } from '../../collectors/github-pr.js';

const mockExec = vi.mocked(exec);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    gitRepo: 'heskethwebdesign/test-app',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GitHubPrCollector', () => {
  const collector = new GitHubPrCollector();

  describe('detect', () => {
    it('returns true when gitRepo is set', () => {
      expect(collector.detect('/tmp', makeApp())).toBe(true);
    });

    it('returns false when no gitRepo', () => {
      expect(collector.detect('/tmp', makeApp({ gitRepo: undefined }))).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns findings for open dependency prs', async () => {
      mockExec.mockReturnValueOnce({
        ok: true,
        stdout: JSON.stringify([
          { number: 1, title: 'chore(deps): update react', url: 'https://github.com/org/repo/pull/1', labels: [] },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('pending-pr');
      expect(findings[0].severity).toBe('info');
    });

    it('filters out non-dependency prs', async () => {
      mockExec.mockReturnValueOnce({
        ok: true,
        stdout: JSON.stringify([
          { number: 1, title: 'feat: add new feature', url: 'https://github.com/org/repo/pull/1', labels: [] },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0);
    });

    it('detects dependency prs by label', async () => {
      mockExec.mockReturnValueOnce({
        ok: true,
        stdout: JSON.stringify([
          { number: 2, title: 'bump stuff', url: 'https://github.com/org/repo/pull/2', labels: [{ name: 'dependencies' }] },
        ]),
        stderr: '',
        exitCode: 0,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(1);
    });

    it('returns empty when gh fails', async () => {
      mockExec.mockReturnValueOnce({
        ok: false, stdout: '', stderr: 'error', exitCode: 1,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0);
    });

    it('returns empty when no gitRepo', async () => {
      const findings = await collector.collect(makeApp({ gitRepo: undefined }));
      expect(findings).toHaveLength(0);
    });
  });
});
