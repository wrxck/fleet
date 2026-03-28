import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export interface ImageRef {
  image: string;
  tag: string;
}

export class DockerImageCollector implements Collector {
  type = 'docker-image' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return (
      existsSync(join(appPath, 'Dockerfile')) ||
      existsSync(join(appPath, 'docker-compose.yml')) ||
      existsSync(join(appPath, 'docker-compose.yaml'))
    );
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const images = new Map<string, ImageRef>();

    const dockerfilePath = join(app.composePath, 'Dockerfile');
    if (existsSync(dockerfilePath)) {
      for (const img of this.parseDockerfile(readFileSync(dockerfilePath, 'utf-8'))) {
        images.set(`${img.image}:${img.tag}`, img);
      }
    }

    const composeFile = app.composeFile ?? 'docker-compose.yml';
    const composePath = join(app.composePath, composeFile);
    if (existsSync(composePath)) {
      for (const img of this.parseComposeImages(readFileSync(composePath, 'utf-8'))) {
        images.set(`${img.image}:${img.tag}`, img);
      }
    }

    const composeYaml = join(app.composePath, 'docker-compose.yaml');
    if (!existsSync(composePath) && existsSync(composeYaml)) {
      for (const img of this.parseComposeImages(readFileSync(composeYaml, 'utf-8'))) {
        images.set(`${img.image}:${img.tag}`, img);
      }
    }

    const findings: Finding[] = [];
    const results = await Promise.allSettled(
      Array.from(images.values()).map(img => this.checkImage(app.name, img))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  parseDockerfile(content: string): ImageRef[] {
    const images: ImageRef[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^FROM\s+(\S+?)(?::(\S+?))?(?:\s+AS\s+\S+)?$/i);
      if (match) {
        images.push({ image: match[1], tag: match[2] ?? 'latest' });
      }
    }
    return images;
  }

  parseComposeImages(content: string): ImageRef[] {
    const images: ImageRef[] = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^\s+image:\s*['"]?(\S+?)(?::(\S+?))?['"]?\s*$/);
      if (match) {
        images.push({ image: match[1], tag: match[2] ?? 'latest' });
      }
    }
    return images;
  }

  private async checkImage(appName: string, img: ImageRef): Promise<Finding | null> {
    const tagVersion = img.tag.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!tagVersion) return null;

    // only check docker hub library images for now
    const isLibrary = !img.image.includes('/') || img.image.startsWith('library/');
    if (img.image.includes('.') && !img.image.startsWith('docker.io')) return null;

    const namespace = isLibrary ? 'library' : img.image.split('/').slice(0, -1).join('/');
    const repo = isLibrary ? img.image.replace('library/', '') : img.image.split('/').pop()!;

    try {
      const res = await fetch(
        `https://hub.docker.com/v2/repositories/${namespace}/${repo}/tags?page_size=50&ordering=last_updated`
      );
      if (!res.ok) return null;
      const data = await res.json() as { results: Array<{ name: string }> };

      const suffix = img.tag.replace(/^v?\d+(?:\.\d+)*/, '');
      const semverTags = data.results
        .map(t => t.name)
        .filter(name => {
          if (suffix && !name.endsWith(suffix)) return false;
          return /^v?\d+\.\d+/.test(name);
        })
        .sort((a, b) => {
          const av = a.replace(/^v/, '').replace(suffix, '');
          const bv = b.replace(/^v/, '').replace(suffix, '');
          return compareVersions(bv, av);
        });

      if (semverTags.length === 0) return null;

      const latestTag = semverTags[0];
      const currentClean = img.tag.replace(suffix, '').replace(/^v/, '');
      const latestClean = latestTag.replace(suffix, '').replace(/^v/, '');

      if (currentClean === latestClean) return null;

      const severity = severityFromVersionDelta(currentClean, latestClean, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'docker-image',
        severity,
        category: 'image-update',
        title: `${img.image}:${img.tag} -> ${latestTag}`,
        detail: `Docker image ${img.image} has newer tag ${latestTag} available`,
        package: img.image,
        currentVersion: img.tag,
        latestVersion: latestTag,
        fixable: true,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
