import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';
import { ComposerCollector } from '../../collectors/composer.js';

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
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-composer-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ComposerCollector', () => {
  const collector = new ComposerCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when composer.json exists', () => {
      writeFileSync(join(tmpDir, 'composer.json'), '{}');
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns false when no composer.json', () => {
      expect(collector.detect(tmpDir)).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns findings for outdated packages', async () => {
      writeFileSync(join(tmpDir, 'composer.json'), JSON.stringify({
        require: { 'laravel/framework': '^10.0.0' },
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          packages: { 'laravel/framework': [{ version: '11.0.0' }] },
        }),
      });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(1);
      expect(findings[0].source).toBe('composer');
    });

    it('skips php and ext- entries', async () => {
      writeFileSync(join(tmpDir, 'composer.json'), JSON.stringify({
        require: { php: '>=8.1', 'ext-json': '*' },
      }));

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles fetch errors gracefully', async () => {
      writeFileSync(join(tmpDir, 'composer.json'), JSON.stringify({
        require: { 'laravel/framework': '10.0.0' },
      }));

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
    });
  });
});
