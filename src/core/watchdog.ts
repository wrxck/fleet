import { readJson, writeJsonAtomic } from './fs-json';

export const STATE_PATH = '/var/lib/fleet/watchdog-state.json';

/** how long a restart attempt counts against the per-app budget. */
export const RESTART_WINDOW_MS = 60 * 60 * 1000;
/** restart attempts allowed per app inside one window before the watchdog gives up. */
export const MAX_RESTARTS_PER_WINDOW = 2;
/** resend an unchanged failure set at most this often, as a keep-alive digest. */
export const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type FailureSeverity = 'down' | 'degraded';

export interface Failure {
  app: string;
  serviceName: string;
  severity: FailureSeverity;
  reason: string;
  /** true when systemd itself reports the unit as failed — the only case the
   *  watchdog will try to restart. an inactive unit may be deliberate. */
  systemdFailed: boolean;
}

export interface WatchdogState {
  /** signature of the failure set covered by the last alert sent. */
  lastSignature: string;
  /** iso timestamp of the last alert sent. */
  lastAlertAt: string | null;
  /** app name -> iso timestamps of restart attempts, oldest first. */
  restarts: Record<string, string[]>;
}

export function emptyState(): WatchdogState {
  return { lastSignature: '', lastAlertAt: null, restarts: {} };
}

export function loadState(path: string = STATE_PATH): WatchdogState {
  const raw = readJson<Partial<WatchdogState>>(path);
  if (!raw) return emptyState();
  return {
    lastSignature: typeof raw.lastSignature === 'string' ? raw.lastSignature : '',
    lastAlertAt: typeof raw.lastAlertAt === 'string' ? raw.lastAlertAt : null,
    restarts: isRestartMap(raw.restarts) ? raw.restarts : {},
  };
}

function isRestartMap(v: unknown): v is Record<string, string[]> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    entry => Array.isArray(entry) && entry.every(x => typeof x === 'string'),
  );
}

export function saveState(state: WatchdogState, path: string = STATE_PATH): void {
  writeJsonAtomic(path, state);
}

/**
 * a stable fingerprint of the current failure set. two runs with the same set
 * produce the same signature, so an unchanged set is not re-alerted.
 */
export function computeSignature(failures: Failure[]): string {
  return failures
    .map(f => `${f.severity}:${f.app}`)
    .sort()
    .join('|');
}

export type AlertDecision = 'changed' | 'digest' | 'recovered' | 'suppress';

/**
 * only alert when something a human can act on has changed, or once a day as a
 * keep-alive. an unchanged 24-line message every 15 minutes trains the reader
 * to ignore it, which is how a dead production site survived 14 hours.
 */
export function decideAlert(
  state: WatchdogState,
  signature: string,
  now: Date,
  digestIntervalMs: number = DIGEST_INTERVAL_MS,
): AlertDecision {
  if (signature === '') {
    return state.lastSignature === '' ? 'suppress' : 'recovered';
  }
  if (signature !== state.lastSignature) return 'changed';
  const last = state.lastAlertAt ? Date.parse(state.lastAlertAt) : NaN;
  if (Number.isNaN(last)) return 'changed';
  return now.getTime() - last >= digestIntervalMs ? 'digest' : 'suppress';
}

/** drop restart attempts that have aged out of the window. */
export function pruneRestarts(
  state: WatchdogState,
  now: Date,
  windowMs: number = RESTART_WINDOW_MS,
): WatchdogState {
  const cutoff = now.getTime() - windowMs;
  const restarts: Record<string, string[]> = {};
  for (const [app, stamps] of Object.entries(state.restarts)) {
    const kept = stamps.filter(s => {
      const t = Date.parse(s);
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (kept.length > 0) restarts[app] = kept;
  }
  return { ...state, restarts };
}

/**
 * the apps the watchdog may restart on this run. two conditions, both required:
 *
 * - severity is 'down', so there is no running container and a restart can cost
 *   nothing. a degraded app is still serving, and "systemctl restart" runs the
 *   unit's ExecStop first, which would take a working container away.
 * - systemd reports the unit as failed. an inactive unit can be a deliberate
 *   stop, and restarting it would fight the operator.
 */
export function selectRemediationTargets(
  failures: Failure[],
  state: WatchdogState,
  maxPerWindow: number = MAX_RESTARTS_PER_WINDOW,
): Failure[] {
  return failures.filter(f => {
    if (f.severity !== 'down') return false;
    if (!f.systemdFailed) return false;
    const attempts = state.restarts[f.app]?.length ?? 0;
    return attempts < maxPerWindow;
  });
}

export function recordRestart(state: WatchdogState, app: string, now: Date): WatchdogState {
  const stamps = state.restarts[app] ?? [];
  return {
    ...state,
    restarts: { ...state.restarts, [app]: [...stamps, now.toISOString()] },
  };
}

export interface RemediationOutcome {
  app: string;
  serviceName: string;
  ok: boolean;
  error?: string;
  /** attempt number inside the current window, 1-based. */
  attempt: number;
}

/**
 * restart every eligible failed unit. the restart function is injected so the
 * policy can be tested without touching systemd.
 */
export function remediate(
  failures: Failure[],
  state: WatchdogState,
  now: Date,
  restart: (serviceName: string) => { ok: boolean; error?: string },
  maxPerWindow: number = MAX_RESTARTS_PER_WINDOW,
): { state: WatchdogState; outcomes: RemediationOutcome[] } {
  let next = state;
  const outcomes: RemediationOutcome[] = [];
  for (const f of selectRemediationTargets(failures, state, maxPerWindow)) {
    const attempt = (next.restarts[f.app]?.length ?? 0) + 1;
    const result = restart(f.serviceName);
    next = recordRestart(next, f.app, now);
    outcomes.push({ app: f.app, serviceName: f.serviceName, ok: result.ok, error: result.error, attempt });
  }
  return { state: next, outcomes };
}

/**
 * split the message so a dead site is not buried among units that are merely
 * inactive. "down" means no running container; "degraded" means it answers but
 * something about it is wrong.
 */
export function formatAlert(
  hostname: string,
  failures: Failure[],
  outcomes: RemediationOutcome[],
  decision: AlertDecision,
): string {
  if (failures.length === 0) {
    const lines = ['fleet watchdog: recovered', `host: ${hostname}`, '', 'all services healthy'];
    appendOutcomes(lines, outcomes);
    return lines.join('\n');
  }

  const down = failures.filter(f => f.severity === 'down');
  const degraded = failures.filter(f => f.severity === 'degraded');
  const heading = decision === 'digest'
    ? 'fleet watchdog alert (daily digest, unchanged)'
    : 'fleet watchdog alert';

  const lines = [heading, `host: ${hostname}`, `down: ${down.length}  degraded: ${degraded.length}`];

  if (down.length > 0) {
    lines.push('', 'DOWN');
    for (const f of down) lines.push(`- ${f.app}: ${f.reason}`);
  }
  if (degraded.length > 0) {
    lines.push('', 'degraded');
    for (const f of degraded) lines.push(`- ${f.app}: ${f.reason}`);
  }
  appendOutcomes(lines, outcomes);
  return lines.join('\n');
}

function appendOutcomes(lines: string[], outcomes: RemediationOutcome[]): void {
  if (outcomes.length === 0) return;
  lines.push('', 'restart attempts');
  for (const o of outcomes) {
    lines.push(`- ${o.app} (attempt ${o.attempt}): ${o.ok ? 'restarted' : `failed — ${o.error ?? 'unknown error'}`}`);
  }
}

/**
 * the fingerprint the alert decision runs on. restart activity is folded in so
 * a remediation is always reported once, even when the app came back and the
 * failure set is now empty.
 */
export function alertSignature(failures: Failure[], outcomes: RemediationOutcome[]): string {
  const restarts = outcomes.map(o => `restart:${o.app}:${o.attempt}`).sort().join('|');
  return [computeSignature(failures), restarts].filter(Boolean).join('#');
}
