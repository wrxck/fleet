import { exec } from '../../exec.js';
import type { AppEntry } from '../../registry.js';
import type { Collector, Finding, DepsConfig } from '../types.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

interface InspectResult {
  image: string;
  tag: string;
  digest: string;
}

export class DockerRunningCollector implements Collector {
  type = 'docker-running' as const;

  constructor(private _overrides: SeverityOverrides) {}

  detect(_appPath: string, app?: AppEntry): boolean {
    return (app?.containers?.length ?? 0) > 0;
  }

  async collect(app: AppEntry): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const container of app.containers) {
      const result = exec(`docker inspect ${container}`, { timeout: 10_000 });
      if (!result.ok) continue;

      const info = this.parseInspectOutput(result.stdout);
      if (!info) continue;

      // check if running image differs from what compose/dockerfile specifies
      // this is drift detection — the container is running but may be stale
      const tagVersion = info.tag.match(/^v?(\d+)(?:\.(\d+))?/);
      if (!tagVersion) continue;

      findings.push({
        appName: app.name,
        source: 'docker-running',
        severity: 'info',
        category: 'image-update',
        title: `${container} running ${info.image}:${info.tag}`,
        detail: `Container ${container} is running image ${info.image}:${info.tag} (digest: ${info.digest.slice(0, 19)})`,
        package: info.image,
        currentVersion: info.tag,
        fixable: false,
        updatedAt: new Date().toISOString(),
      });
    }

    return findings;
  }

  parseInspectOutput(json: string): InspectResult | null {
    try {
      const data = JSON.parse(json) as Array<{
        Config: { Image: string };
        Image: string;
      }>;
      if (!data[0]) return null;

      const imageStr = data[0].Config.Image;
      const parts = imageStr.split(':');
      const tag = parts.length > 1 ? parts.pop()! : 'latest';
      const image = parts.join(':');

      return { image, tag, digest: data[0].Image };
    } catch {
      return null;
    }
  }
}
