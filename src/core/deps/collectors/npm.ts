import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

const NPM_REGISTRY_TIMEOUT_MS = 10_000;

export class NpmCollector implements Collector {
  type = 'npm' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return existsSync(join(appPath, 'package.json'));
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const pkgPath = join(app.composePath, 'package.json');
    if (!existsSync(pkgPath)) return [];

    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const findings: Finding[] = [];
    const entries = Object.entries(allDeps);
    const BATCH_SIZE = 10;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(([name, version]) => this.checkPackage(app.name, name, version))
      );
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          findings.push(result.value);
        }
      }
    }

    return findings;
  }

  private async checkPackage(
    appName: string,
    name: string,
    currentRaw: string,
  ): Promise<Finding | null> {
    const current = currentRaw.replace(/^[^\d]*/, '');

    try {
      const res = await fetchWithTimeout(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
        {},
        NPM_REGISTRY_TIMEOUT_MS,
      );
      if (!res.ok) return null;
      const data = await res.json() as { version: string };
      const latest = data.version;

      if (current === latest) return null;

      const severity = severityFromVersionDelta(current, latest, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'npm',
        severity,
        category: 'outdated-dep',
        title: `${name} ${current} -> ${latest}`,
        detail: `npm package ${name} can be updated from ${current} to ${latest}`,
        package: name,
        currentVersion: current,
        latestVersion: latest,
        fixable: true,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
