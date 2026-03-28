import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppEntry } from '../../../registry.js';
import { EolCollector } from '../../collectors/eol.js';

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
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-eol-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('EolCollector', () => {
  const collector = new EolCollector(90);

  describe('detectRuntimes', () => {
    it('detects node from package.json engines', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=18' } }));
      const runtimes = collector.detectRuntimes(tmpDir);
      expect(runtimes).toContainEqual({ product: 'node', version: '18' });
    });

    it('detects node from .nvmrc', () => {
      writeFileSync(join(tmpDir, '.nvmrc'), '20\n');
      const runtimes = collector.detectRuntimes(tmpDir);
      expect(runtimes).toContainEqual({ product: 'node', version: '20' });
    });

    it('detects php from composer.json', () => {
      writeFileSync(join(tmpDir, 'composer.json'), JSON.stringify({ require: { php: '>=8.2' } }));
      const runtimes = collector.detectRuntimes(tmpDir);
      expect(runtimes).toContainEqual({ product: 'php', version: '8.2' });
    });

    it('detects runtime from Dockerfile FROM', () => {
      writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:20-alpine\nRUN npm install');
      const runtimes = collector.detectRuntimes(tmpDir);
      expect(runtimes).toContainEqual({ product: 'node', version: '20' });
    });

    it('returns empty for directory with no manifest files', () => {
      expect(collector.detectRuntimes(tmpDir)).toEqual([]);
    });
  });

  describe('detect', () => {
    it('returns true when runtimes detected', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=18' } }));
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns false when no runtimes', () => {
      expect(collector.detect(tmpDir)).toBe(false);
    });
  });

  describe('collect', () => {
    it('returns eol-warning for approaching EOL', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=18' } }));

      const eolDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eol: eolDate }),
      });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('eol-warning');
      expect(findings[0].severity).toBe('high');
    });

    it('returns critical for boolean eol: true', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=16' } }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eol: true }),
      });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('critical');
    });

    it('returns empty for far-away EOL', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ engines: { node: '>=22' } }));

      const farDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ eol: farDate }),
      });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
    });
  });
});
