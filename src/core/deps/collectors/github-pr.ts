import { execSafe } from '../../exec.js';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding } from '../types.js';

interface GhPr {
  number: number;
  title: string;
  url: string;
  labels: Array<{ name: string }>;
}

export class GitHubPrCollector implements Collector {
  type = 'github-pr' as const;

  detect(_appPath: string, app?: AppEntry): boolean {
    return !!app?.gitRepo;
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    if (!app.gitRepo) return [];

    const result = execSafe('gh', [
      'pr', 'list', '--repo', app.gitRepo!, '--state', 'open',
      '--json', 'number,title,url,labels', '--limit', '50',
    ], { timeout: 15_000 });

    if (!result.ok) return [];

    try {
      const prs = JSON.parse(result.stdout) as GhPr[];
      return prs
        .filter(pr => this.isDependencyPr(pr))
        .map(pr => ({
          appName: app.name,
          source: 'github-pr' as const,
          severity: 'info' as const,
          category: 'pending-pr' as const,
          title: `PR #${pr.number}: ${pr.title}`,
          detail: `Open dependency PR: ${pr.url}`,
          prUrl: pr.url,
          fixable: false,
          updatedAt: new Date().toISOString(),
        }));
    } catch {
      return [];
    }
  }

  private isDependencyPr(pr: GhPr): boolean {
    const depLabels = ['dependencies', 'deps', 'renovate', 'dependabot'];
    if (pr.labels.some(l => depLabels.includes(l.name.toLowerCase()))) return true;

    const depPrefixes = ['chore(deps)', 'fix(deps)', 'deps/', 'build(deps)'];
    return depPrefixes.some(prefix => pr.title.toLowerCase().startsWith(prefix));
  }
}
