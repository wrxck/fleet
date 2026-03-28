import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';
import { severityFromEol } from '../severity.js';

interface RuntimeRef {
  product: string;
  version: string;
}

export class EolCollector implements Collector {
  type = 'eol' as const;

  constructor(private warningDays: number) {}

  detect(appPath: string): boolean {
    return this.detectRuntimes(appPath).length > 0;
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const runtimes = this.detectRuntimes(app.composePath);
    const findings: Finding[] = [];

    const results = await Promise.allSettled(
      runtimes.map(rt => this.checkEol(app.name, rt))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        findings.push(result.value);
      }
    }

    return findings;
  }

  detectRuntimes(appPath: string): RuntimeRef[] {
    const runtimes: RuntimeRef[] = [];

    // node from package.json engines
    const pkgPath = join(appPath, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const nodeEngine = pkg.engines?.node;
        if (nodeEngine) {
          const ver = nodeEngine.match(/(\d+)/);
          if (ver) runtimes.push({ product: 'node', version: ver[1] });
        }
      } catch { /* skip */ }
    }

    // node from .nvmrc
    const nvmrcPath = join(appPath, '.nvmrc');
    if (existsSync(nvmrcPath)) {
      const ver = readFileSync(nvmrcPath, 'utf-8').trim().match(/(\d+)/);
      if (ver && !runtimes.some(r => r.product === 'node')) {
        runtimes.push({ product: 'node', version: ver[1] });
      }
    }

    // php from composer.json
    const composerPath = join(appPath, 'composer.json');
    if (existsSync(composerPath)) {
      try {
        const composer = JSON.parse(readFileSync(composerPath, 'utf-8'));
        const phpReq = composer.require?.php;
        if (phpReq) {
          const ver = phpReq.match(/(\d+\.\d+)/);
          if (ver) runtimes.push({ product: 'php', version: ver[1] });
        }
      } catch { /* skip */ }
    }

    // python from pyproject.toml
    const pyprojectPath = join(appPath, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, 'utf-8');
        const ver = content.match(/requires-python\s*=\s*">=?(\d+\.\d+)"/);
        if (ver) runtimes.push({ product: 'python', version: ver[1] });
      } catch { /* skip */ }
    }

    // runtimes from dockerfile FROM lines
    const dockerfilePath = join(appPath, 'Dockerfile');
    if (existsSync(dockerfilePath)) {
      try {
        const content = readFileSync(dockerfilePath, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(/^FROM\s+(node|php|python):(\d+(?:\.\d+)?)/i);
          if (match) {
            const product = match[1].toLowerCase();
            if (!runtimes.some(r => r.product === product)) {
              runtimes.push({ product, version: match[2] });
            }
          }
        }
      } catch { /* skip */ }
    }

    return runtimes;
  }

  private async checkEol(appName: string, rt: RuntimeRef): Promise<Finding | null> {
    try {
      const res = await fetch(`https://endoflife.date/api/${rt.product}/${rt.version}.json`);
      if (!res.ok) return null;
      const data = await res.json() as { eol: string | boolean };

      if (typeof data.eol === 'boolean') {
        if (data.eol) {
          return {
            appName,
            source: 'eol',
            severity: 'critical',
            category: 'eol-warning',
            title: `${rt.product} ${rt.version} is end-of-life`,
            detail: `${rt.product} ${rt.version} has reached end of life and no longer receives updates`,
            package: rt.product,
            currentVersion: rt.version,
            fixable: false,
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      }

      const severity = severityFromEol(data.eol, this.warningDays);
      if (severity === 'info') return null;

      const daysUntil = Math.ceil(
        (new Date(data.eol).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );

      return {
        appName,
        source: 'eol',
        severity,
        category: 'eol-warning',
        title: daysUntil <= 0
          ? `${rt.product} ${rt.version} is end-of-life`
          : `${rt.product} ${rt.version} EOL in ${daysUntil} days`,
        detail: `${rt.product} ${rt.version} reaches end of life on ${data.eol}`,
        eolDate: data.eol,
        package: rt.product,
        currentVersion: rt.version,
        fixable: false,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
