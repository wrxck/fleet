import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';
import { severityFromVersionDelta } from '../severity.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export class PipCollector implements Collector {
  type = 'pip' as const;

  constructor(private overrides: SeverityOverrides) {}

  detect(appPath: string): boolean {
    return (
      existsSync(join(appPath, 'requirements.txt')) ||
      existsSync(join(appPath, 'pyproject.toml'))
    );
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const deps = this.parseDeps(app.composePath);
    if (deps.length === 0) return [];

    const findings: Finding[] = [];
    const results = await Promise.allSettled(
      deps.map(([name, version]) => this.checkPackage(app.name, name, version))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  private parseDeps(appPath: string): [string, string][] {
    const reqPath = join(appPath, 'requirements.txt');
    if (existsSync(reqPath)) {
      return this.parseRequirementsTxt(readFileSync(reqPath, 'utf-8'));
    }

    const pyprojectPath = join(appPath, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      return this.parsePyprojectToml(readFileSync(pyprojectPath, 'utf-8'));
    }

    return [];
  }

  private parseRequirementsTxt(content: string): [string, string][] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('-'))
      .map(line => {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([^\s;]+)/);
        if (!match) return null;
        return [match[1], match[2]] as [string, string];
      })
      .filter((entry): entry is [string, string] => entry !== null);
  }

  private parsePyprojectToml(content: string): [string, string][] {
    const deps: [string, string][] = [];
    const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (!depMatch) return deps;

    const lines = depMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/"([a-zA-Z0-9_-]+)==([^"]+)"/);
      if (match) deps.push([match[1], match[2]]);
    }
    return deps;
  }

  private async checkPackage(
    appName: string,
    name: string,
    current: string,
  ): Promise<Finding | null> {
    try {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
      if (!res.ok) return null;
      const data = await res.json() as { info: { version: string } };
      const latest = data.info.version;

      if (current === latest) return null;

      const severity = severityFromVersionDelta(current, latest, this.overrides);
      if (severity === 'info') return null;

      return {
        appName,
        source: 'pip',
        severity,
        category: 'outdated-dep',
        title: `${name} ${current} -> ${latest}`,
        detail: `Python package ${name} can be updated from ${current} to ${latest}`,
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
