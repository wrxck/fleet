import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../exec.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../../../exec.js';
import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';
import { DockerRunningCollector } from '../../collectors/docker-running.js';

const mockExec = vi.mocked(exec);

function makeApp(overrides: Partial<AppEntry> = {}): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath: '/tmp/test-app',
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app-web'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('DockerRunningCollector', () => {
  const collector = new DockerRunningCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when app has containers', () => {
      expect(collector.detect('/tmp', makeApp())).toBe(true);
    });

    it('returns false when no containers', () => {
      expect(collector.detect('/tmp', makeApp({ containers: [] }))).toBe(false);
    });
  });

  describe('parseInspectOutput', () => {
    it('extracts image and tag from docker inspect json', () => {
      const json = JSON.stringify([{
        Config: { Image: 'node:18-alpine' },
        Image: 'sha256:abc123def456',
      }]);
      const result = collector.parseInspectOutput(json);
      expect(result).toEqual({ image: 'node', tag: '18-alpine', digest: 'sha256:abc123def456' });
    });

    it('returns null for invalid json', () => {
      expect(collector.parseInspectOutput('not json')).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(collector.parseInspectOutput('[]')).toBeNull();
    });
  });

  describe('collect', () => {
    it('returns findings for running containers', async () => {
      mockExec.mockReturnValueOnce({
        ok: true,
        stdout: JSON.stringify([{
          Config: { Image: 'node:18-alpine' },
          Image: 'sha256:abc123',
        }]),
        stderr: '',
        exitCode: 0,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(1);
      expect(findings[0].source).toBe('docker-running');
    });

    it('skips containers that fail to inspect', async () => {
      mockExec.mockReturnValueOnce({
        ok: false, stdout: '', stderr: 'not found', exitCode: 1,
      });

      const findings = await collector.collect(makeApp());
      expect(findings).toHaveLength(0);
    });
  });
});
