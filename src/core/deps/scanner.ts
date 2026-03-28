import type { AppEntry } from '../registry.js';
import type { Collector, DepsCache, DepsConfig, Finding, ScanError } from './types.js';
import { NpmCollector } from './collectors/npm.js';
import { ComposerCollector } from './collectors/composer.js';
import { PipCollector } from './collectors/pip.js';
import { DockerImageCollector } from './collectors/docker-image.js';
import { DockerRunningCollector } from './collectors/docker-running.js';
import { EolCollector } from './collectors/eol.js';
import { VulnerabilityCollector } from './collectors/vulnerability.js';
import { GitHubPrCollector } from './collectors/github-pr.js';

export function createCollectors(config: DepsConfig): Collector[] {
  return [
    new NpmCollector(config.severityOverrides),
    new ComposerCollector(config.severityOverrides),
    new PipCollector(config.severityOverrides),
    new DockerImageCollector(config.severityOverrides),
    new DockerRunningCollector(config.severityOverrides),
    new EolCollector(config.severityOverrides.eolDaysWarning),
    new VulnerabilityCollector(),
    new GitHubPrCollector(),
  ];
}

export async function runScan(
  apps: AppEntry[],
  config: DepsConfig,
  collectors?: Collector[],
): Promise<DepsCache> {
  const start = Date.now();
  const allCollectors = collectors ?? createCollectors(config);
  const findings: Finding[] = [];
  const errors: ScanError[] = [];

  // build work items: [app, collector] pairs where collector.detect passes
  const work: Array<{ app: AppEntry; collector: Collector }> = [];
  for (const app of apps) {
    for (const collector of allCollectors) {
      if (collector.detect(app.composePath)) {
        work.push({ app, collector });
      }
    }
  }

  // run with concurrency limit
  const concurrency = config.concurrency;
  for (let i = 0; i < work.length; i += concurrency) {
    const batch = work.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async ({ app, collector }) => {
        try {
          return await collector.collect(app);
        } catch (err) {
          errors.push({
            collector: collector.type,
            appName: app.name,
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          });
          return [];
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        findings.push(...result.value);
      }
    }
  }

  const filtered = applyIgnoreRules(findings, config.ignore);

  return {
    version: 1,
    lastScan: new Date().toISOString(),
    scanDurationMs: Date.now() - start,
    findings: filtered,
    errors,
    config,
  };
}

function applyIgnoreRules(
  findings: Finding[],
  rules: DepsConfig['ignore'],
): Finding[] {
  if (rules.length === 0) return findings;

  const now = Date.now();
  const activeRules = rules.filter(r => {
    if (r.until) return new Date(r.until).getTime() > now;
    return true;
  });

  return findings.filter(f => {
    return !activeRules.some(rule => {
      if (rule.appName && rule.appName !== f.appName) return false;
      if (rule.package && rule.package !== f.package) return false;
      if (rule.source && rule.source !== f.source) return false;
      return true;
    });
  });
}
