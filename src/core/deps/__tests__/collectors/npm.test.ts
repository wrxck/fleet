import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';
import { NpmCollector } from '../../collectors/npm.js';

let tmpDir: string;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeApp(composePath: string): AppEntry {
  return {
    name: 'test-app', displayName: 'Test App', composePath,
    composeFile: null, serviceName: 'test-app', domains: [], port: 3000,
    usesSharedDb: false, type: 'service', containers: ['test-app'],
    dependsOnDatabases: false, registeredAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-npm-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('NpmCollector', () => {
  const collector = new NpmCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when package.json exists', () => {
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns false when no package.json', () => {
      expect(collector.detect(tmpDir)).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns findings for outdated packages', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { react: '18.3.1' },
        devDependencies: { vitest: '4.0.0' },
      }));

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ version: '19.1.0' }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ version: '4.1.0' }) });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(2);
      expect(findings[0].source).toBe('npm');
      expect(findings[0].category).toBe('outdated-dep');
    });

    it('skips up-to-date packages', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { react: '19.1.0' },
      }));

      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ version: '19.1.0' }) });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
    });

    it('handles fetch errors gracefully', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { react: '18.3.1' },
      }));

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
    });

    it('strips version prefixes', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        dependencies: { react: '^18.3.1' },
      }));

      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ version: '19.1.0' }) });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(1);
      expect(findings[0].currentVersion).toBe('18.3.1');
    });
  });
});
