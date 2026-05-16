import { listConfiguredApps, loadConfig } from './config';
import { listSnapshots, stats, isAppendOnly } from './repo';
import { StatusReport, StatusEntry } from './statuspage';

/** gathers per-app snapshot counts, last-snapshot time and repo size. */
export function buildStatusReport(): StatusReport {
  const apps = listConfiguredApps();
  const entries: StatusEntry[] = [];
  for (const app of apps) {
    const cfg = loadConfig(app);
    if (!cfg) continue;
    const snaps = listSnapshots(app);
    const last = snaps[snaps.length - 1];
    const st = stats(app);
    entries.push({
      app,
      schedule: cfg.schedule,
      disabled: !!cfg.disabled,
      snapshotCount: snaps.length,
      lastSnapshotAt: last?.time ?? null,
      totalSize: st?.totalSize ?? null,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    backend: (process.env.FLEET_BACKUP_BASE_URL ?? '').startsWith('rest:') ? 'rest' : 'sftp',
    appendOnly: isAppendOnly(),
    apps: entries,
  };
}
