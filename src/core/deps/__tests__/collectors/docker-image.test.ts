import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppEntry } from '../../../registry.js';
import { defaultConfig } from '../../config.js';
import { DockerImageCollector } from '../../collectors/docker-image.js';

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
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-docker-image-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('DockerImageCollector', () => {
  const collector = new DockerImageCollector(defaultConfig().severityOverrides);

  describe('detect', () => {
    it('returns true when Dockerfile exists', () => {
      writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:18');
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns true when docker-compose.yml exists', () => {
      writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services:');
      expect(collector.detect(tmpDir)).toBe(true);
    });

    it('returns false when neither exists', () => {
      expect(collector.detect(tmpDir)).toBe(false);
    });
  });

  describe('parseDockerfile', () => {
    it('extracts FROM lines', () => {
      const content = 'FROM node:18-alpine AS builder\nRUN npm install\nFROM node:18-alpine\nCOPY . .';
      const images = collector.parseDockerfile(content);
      expect(images).toEqual([
        { image: 'node', tag: '18-alpine' },
        { image: 'node', tag: '18-alpine' },
      ]);
    });

    it('handles images without tags', () => {
      const images = collector.parseDockerfile('FROM ubuntu\nRUN apt-get update');
      expect(images).toEqual([{ image: 'ubuntu', tag: 'latest' }]);
    });

    it('handles namespaced images', () => {
      const images = collector.parseDockerfile('FROM ghcr.io/owner/image:v1.2.3');
      expect(images).toEqual([{ image: 'ghcr.io/owner/image', tag: 'v1.2.3' }]);
    });
  });

  describe('parseComposeImages', () => {
    it('extracts image: directives', () => {
      const content = `
services:
  web:
    image: nginx:1.25
  db:
    image: postgres:16-alpine
`;
      const images = collector.parseComposeImages(content);
      expect(images).toContainEqual({ image: 'nginx', tag: '1.25' });
      expect(images).toContainEqual({ image: 'postgres', tag: '16-alpine' });
    });
  });

  describe('collect', () => {
    it('returns findings for outdated images', async () => {
      writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:18.0.0-alpine');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { name: '22.0.0-alpine' },
            { name: '20.0.0-alpine' },
            { name: '18.0.0-alpine' },
          ],
        }),
      });

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(1);
      expect(findings[0].source).toBe('docker-image');
      expect(findings[0].category).toBe('image-update');
    });

    it('skips non-semver tags', async () => {
      writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:alpine');

      const findings = await collector.collect(makeApp(tmpDir));
      expect(findings).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
