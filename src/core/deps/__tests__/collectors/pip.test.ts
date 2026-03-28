import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';
import { PipCollector } from '../../collectors/pip.js';

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
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-pip-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('PipCollector', () => {
  const collector = new PipCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when requirements.txt exists', () => {
      writeFileSync(join(tmpDir, 'requirements.txt'), 'django==4.2.0\n');
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns true when pyproject.toml exists', () => {
      writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]\n');
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns false when neither exists', () => {
      expect(collector.detect(tmpDir)).toBe(false);
    });
  });

  describe('collect', () => {
    it('parses requirements.txt and returns findings', async () => {
      writeFileSync(join(tmpDir, 'requirements.txt'), 'django==4.2.0\nflask==2.3.0\n');

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ info: { version: '5.1.0' } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ info: { version: '3.1.0' } }) });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(2);
      expect(findings[0].source).toBe('pip');
    });

    it('skips comments and blank lines', async () => {
      writeFileSync(join(tmpDir, 'requirements.txt'), '# a comment\n\ndjango==4.2.0\n');

      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ info: { version: '5.1.0' } }) });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(1);
    });

    it('handles fetch errors gracefully', async () => {
      writeFileSync(join(tmpDir, 'requirements.txt'), 'django==4.2.0\n');
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
    });
  });
});
