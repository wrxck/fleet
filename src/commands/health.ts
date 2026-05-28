import { z } from 'zod';

import { load, findApp } from '../core/registry';
import { checkHealth, checkAllHealth, type HealthResult } from '../core/health';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const healthCommand = defineCommand({
  name: 'health',
  summary: 'Health checks: systemd + container + HTTP',
  args: z.object({ app: z.string().optional() }),
  tui: { view: 'health' },
  async run(args): Promise<CommandResult<HealthResult[]>> {
    let results: HealthResult[];
    if (args.app) {
      const app = findApp(load(), args.app);
      if (!app) {
        return { ok: false, summary: `app not found: ${args.app}`, data: [] };
      }
      results = [checkHealth(app)];
    } else {
      results = checkAllHealth(load().apps);
    }
    const healthy = results.filter(r => r.overall === 'healthy').length;
    const degraded = results.filter(r => r.overall === 'degraded').length;
    const down = results.filter(r => r.overall === 'down').length;
    return {
      ok: true,
      summary: `${results.length} checked | ${healthy} healthy | ${degraded} degraded | ${down} down`,
      data: results,
      render: {
        kind: 'table',
        columns: ['APP', 'SYSTEMD', 'CONTAINERS', 'HTTP', 'OVERALL'],
        rows: results.map(r => [
          r.app,
          r.systemd.state,
          `${r.containers.filter(ct => ct.running).length}/${r.containers.length}`,
          r.http ? (r.http.ok ? String(r.http.status ?? 'ok') : 'fail') : '—',
          r.overall,
        ]),
      },
    };
  },
});
