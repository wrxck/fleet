import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export class ComposerCollector implements Collector {
  type = 'composer' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return existsSync(join(appPath, 'composer.json'));
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const composerPath = join(app.composePath, 'composer.json');
    if (!existsSync(composerPath)) return [];

    const raw = readFileSync(composerPath, 'utf-8');
    const composer = JSON.parse(raw) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };

    const allDeps: Record<string, string> = {
      ...composer.require,
      ...composer['require-dev'],
    };

    const packages = Object.entries(allDeps).filter(
      ([name]) => !name.startsWith('php') && !name.startsWith('ext-') && !name.startsWith('lib-')
    );

    const findings: Finding[] = [];
    const results = await Promise.allSettled(
      packages.map(([name, version]) => this.checkPackage(app.name, name, version))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  private async checkPackage(
    appName: string,
    name: string,
    currentRaw: string,
  ): Promise<Finding | null> {
    const current = currentRaw.replace(/^[\^~>=<*]/, '').replace(/\.\*$/, '.0');

    try {
      const res = await fetch(`https://repo.packagist.org/p2/${name}.json`);
      if (!res.ok) return null;
      const data = await res.json() as { packages: Record<string, Array<{ version: string }>> };
      const versions = data.packages[name];
      if (!versions?.length) return null;

      const stable = versions.find(v =>
        /^\d+\.\d+\.\d+$/.test(v.version) || /^v\d+\.\d+\.\d+$/.test(v.version)
      );
      if (!stable) return null;
      const latest = stable.version.replace(/^v/, '');

      if (current === latest) return null;

      const severity = severityFromVersionDelta(current, latest, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'composer',
        severity,
        category: 'outdated-dep',
        title: `${name} ${current} -> ${latest}`,
        detail: `Composer package ${name} can be updated from ${current} to ${latest}`,
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
