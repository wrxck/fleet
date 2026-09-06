import { readFileSync } from 'node:fs';

import { load, type AppEntry } from '../core/registry';
import { checkAllHealth, checkHealth, type HealthResult } from '../core/health';
import { getServiceStatus, restartServiceResult } from '../core/systemd';
import { loadNotifyConfig, sendNotification } from '../core/notify';
import {
  alertSignature,
  decideAlert,
  type AlertDecision,
  type WatchdogState,
  formatAlert,
  loadState,
  pruneRestarts,
  remediate,
  saveState,
  type Failure,
  type RemediationOutcome,
} from '../core/watchdog';
import { error, success, warn } from '../ui/output';

/**
 * the state file lives under /var/lib and the timer runs the watchdog as root.
 * a human running "fleet watchdog" by hand must still get the report rather
 * than an EACCES stack trace, so a failed write only warns.
 */
function persist(state: WatchdogState): boolean {
  try {
    saveState(state);
    return true;
  } catch (err) {
    warn(`could not write watchdog state: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function getHostname(): string {
  try {
    return readFileSync('/etc/hostname', 'utf-8').trim();
  } catch {
    return 'unknown';
  }
}

function toFailure(app: AppEntry, r: HealthResult, dbServiceName: string): Failure | null {
  const systemdFailed = r.systemd.state === 'failed';
  // a stale registry can list the shared databases as an app as well. restarting
  // that unit runs its ExecStop and takes every database down, so it is never a
  // remediation target no matter which list it arrived on.
  const remediable = app.name !== dbServiceName && app.serviceName !== dbServiceName;
  if (r.overall === 'down') {
    return {
      app: r.app,
      serviceName: app.serviceName,
      severity: 'down',
      reason: `no running container (systemd: ${r.systemd.state})`,
      systemdFailed,
      remediable,
    };
  }
  if (r.overall === 'degraded') {
    const reasons: string[] = [];
    if (!r.systemd.ok) reasons.push(`systemd: ${r.systemd.state}`);
    const dead = r.containers.filter(c => !c.running).map(c => c.name);
    if (dead.length > 0) reasons.push(`containers down: ${dead.join(', ')}`);
    if (r.http && !r.http.ok) reasons.push('http check failed');
    return {
      app: r.app,
      serviceName: app.serviceName,
      severity: 'degraded',
      reason: reasons.join('; '),
      systemdFailed,
      remediable,
    };
  }
  return null;
}

function collectFailures(apps: AppEntry[], dbServiceName: string): Failure[] {
  const byName = new Map(apps.map(a => [a.name, a]));
  const failures: Failure[] = [];
  for (const r of checkAllHealth(apps)) {
    const app = byName.get(r.app);
    if (!app) continue;
    const f = toFailure(app, r, dbServiceName);
    if (f) failures.push(f);
  }
  return failures;
}

function printFailures(failures: Failure[]): void {
  const down = failures.filter(f => f.severity === 'down');
  const degraded = failures.filter(f => f.severity === 'degraded');
  warn(`${down.length} down, ${degraded.length} degraded`);
  for (const f of down) error(`  DOWN ${f.app}: ${f.reason}`);
  for (const f of degraded) error(`  ${f.app}: ${f.reason}`);
}

export async function watchdogCommand(args: string[]): Promise<void> {
  const isMotd = args.includes('--motd');
  const noRemediate = args.includes('--no-remediate');
  const force = args.includes('--force-alert');
  const hostname = getHostname();
  const now = new Date();

  const reg = load();
  const apps = reg.apps;

  // the shared databases service is not a registered app, so check it on its own
  const dbServiceName = reg.infrastructure.databases.serviceName;
  const dbStatus = getServiceStatus(dbServiceName);
  let failures = collectFailures(apps, dbServiceName);
  const alreadyListed = failures.some(f => f.app === dbServiceName);
  if (!dbStatus.active && !alreadyListed) {
    failures.unshift({
      app: dbServiceName,
      serviceName: dbServiceName,
      severity: 'down',
      reason: `systemd ${dbStatus.state}`,
      systemdFailed: dbStatus.state === 'failed',
      // the shared databases are reported from systemd alone, with no container
      // check, so the watchdog must not restart them. every app on the box
      // depends on them and a needless restart would be an outage of its own.
      remediable: false,
    });
  }

  // motd mode is a read-only display: no restarts, no alerts, no state written
  if (isMotd) {
    if (failures.length === 0) {
      success(`All ${apps.length + 1} services healthy`);
      return;
    }
    printFailures(failures);
    return;
  }

  let state = pruneRestarts(loadState(), now);
  let outcomes: RemediationOutcome[] = [];

  if (!noRemediate) {
    // the attempt is written before the restart is issued. the budget lives
    // only in that file, so a restart that outran its own record would have no
    // rate limit at all — on a full disk that becomes a restart loop.
    const result = remediate(failures, state, now, restartServiceResult, { commit: persist });
    state = result.state;
    outcomes = result.outcomes;
    if (result.aborted) {
      warn('remediation stopped: the watchdog state file could not be written');
    }

    // re-check only what was restarted, so an app that came back does not raise
    // an alert that is already stale by the time a human reads it
    if (outcomes.length > 0) {
      const restarted = new Set(outcomes.filter(o => o.ok).map(o => o.app));
      if (restarted.size > 0) {
        const recheck = new Map<string, HealthResult>();
        for (const app of apps.filter(a => restarted.has(a.name))) {
          recheck.set(app.name, checkHealth(app));
        }
        const byName = new Map(apps.map(a => [a.name, a]));
        failures = failures.filter(f => {
          const r = recheck.get(f.app);
          if (!r) return true;
          const app = byName.get(f.app);
          return app ? toFailure(app, r, dbServiceName) !== null : true;
        });
      }
    }
  }

  if (failures.length === 0 && outcomes.length === 0) {
    success(`All ${apps.length + 1} services healthy`);
  } else {
    printFailures(failures);
    for (const o of outcomes) {
      const line = `  restart ${o.app} (attempt ${o.attempt}): ${o.ok ? 'ok' : `failed — ${o.error ?? 'unknown error'}`}`;
      if (o.ok) success(line); else error(line);
    }
  }

  const signature = alertSignature(failures, outcomes);
  const decision: AlertDecision = force ? 'changed' : decideAlert(state, signature, now);

  if (decision === 'suppress') {
    persist(state);
    return;
  }

  const config = loadNotifyConfig();
  if (!config) {
    warn('No notify config at /etc/fleet/notify.json — alert not sent');
    persist(state);
    process.exit(1);
  }

  const sent = await sendNotification(config, formatAlert(hostname, failures, outcomes, decision));
  if (sent) {
    success(`Alert sent (${decision})`);
    // only advance the fingerprint once the alert is actually out, so a failed
    // send is retried on the next run instead of being suppressed as a repeat
    state = { ...state, lastSignature: signature, lastAlertAt: now.toISOString() };
    persist(state);
    return;
  }

  error('Failed to send alert');
  persist(state);
  process.exit(1);
}
