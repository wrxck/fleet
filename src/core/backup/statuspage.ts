/** read-only backup status dashboard. rendered to static html by a systemd
 *  timer and served at fleet.hesketh.pro/backups (home-ip restricted in nginx). */

export interface StatusEntry {
  app: string;
  schedule: string;
  disabled: boolean;
  snapshotCount: number;
  lastSnapshotAt: string | null;
  totalSize: number | null;
}

export interface StatusReport {
  generatedAt: string;
  backend: 'rest' | 'sftp';
  appendOnly: boolean;
  apps: StatusEntry[];
}

export type Health = 'ok' | 'stale' | 'missing' | 'disabled';

/** how long after the expected cadence a backup is considered stale.
 *  generous — covers the timer's randomised delay plus a missed run. */
function stalenessThresholdMs(schedule: string): number {
  const hour = 3_600_000;
  if (schedule === 'hourly') return 3 * hour;
  if (schedule === 'weekly') return 8.5 * 24 * hour;
  if (schedule.includes('00/3')) return 7 * hour;
  if (schedule.includes('00/6')) return 13 * hour;
  if (schedule.includes('00/12')) return 25 * hour;
  // daily and anything unrecognised
  return 28 * hour;
}

export function healthOf(entry: StatusEntry, now = Date.now()): Health {
  if (entry.disabled) return 'disabled';
  if (!entry.lastSnapshotAt || entry.snapshotCount === 0) return 'missing';
  const age = now - new Date(entry.lastSnapshotAt).getTime();
  return age > stalenessThresholdMs(entry.schedule) ? 'stale' : 'ok';
}

export function humanBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = now - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

/** renders the full standalone html page. no external assets — inline css so
 *  it works as a flat file behind nginx. */
export function renderStatusHtml(report: StatusReport, now = Date.now()): string {
  const apps = [...report.apps].sort((a, b) => a.app.localeCompare(b.app));
  const counts = { ok: 0, stale: 0, missing: 0, disabled: 0 };
  for (const a of apps) counts[healthOf(a, now)]++;

  const totalBytes = apps.reduce((s, a) => s + (a.totalSize ?? 0), 0);

  const rows = apps.map(a => {
    const h = healthOf(a, now);
    return `      <tr class="h-${h}">
        <td class="dot"><span class="d d-${h}" title="${h}"></span></td>
        <td class="app">${esc(a.app)}</td>
        <td>${esc(a.schedule)}</td>
        <td class="num">${a.snapshotCount}</td>
        <td>${esc(relativeTime(a.lastSnapshotAt, now))}</td>
        <td class="num">${humanBytes(a.totalSize)}</td>
      </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>fleet backups</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem;
    background: #0d1117; color: #c9d1d9;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  h1 { font-size: 1.1rem; margin: 0 0 0.25rem; color: #e6edf3; }
  .meta { color: #8b949e; margin-bottom: 1.25rem; font-size: 0.8rem; }
  .badges { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  .badge {
    padding: 0.3rem 0.7rem; border-radius: 6px; font-size: 0.8rem;
    background: #161b22; border: 1px solid #30363d;
  }
  .badge b { color: #e6edf3; }
  .badge.ok b { color: #3fb950; }
  .badge.stale b { color: #d29922; }
  .badge.missing b { color: #f85149; }
  table { border-collapse: collapse; width: 100%; max-width: 880px; }
  th, td { text-align: left; padding: 0.45rem 0.8rem; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.app { color: #e6edf3; }
  td.dot { width: 1.5rem; }
  .d { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
  .d-ok { background: #3fb950; }
  .d-stale { background: #d29922; }
  .d-missing { background: #f85149; }
  .d-disabled { background: #484f58; }
  tr.h-stale td.app { color: #d29922; }
  tr.h-missing td.app { color: #f85149; }
  tr.h-disabled { opacity: 0.5; }
  tfoot td { border-top: 2px solid #30363d; border-bottom: none; color: #8b949e; padding-top: 0.7rem; }
</style>
</head>
<body>
  <h1>fleet backups</h1>
  <div class="meta">
    generated ${esc(report.generatedAt)} ·
    backend <b>${esc(report.backend)}</b> ·
    ${report.appendOnly ? 'append-only enforced' : 'append-only OFF'}
  </div>
  <div class="badges">
    <span class="badge ok"><b>${counts.ok}</b> ok</span>
    <span class="badge stale"><b>${counts.stale}</b> stale</span>
    <span class="badge missing"><b>${counts.missing}</b> missing</span>
    <span class="badge"><b>${counts.disabled}</b> disabled</span>
  </div>
  <table>
    <thead>
      <tr><th></th><th>app</th><th>schedule</th><th>snaps</th><th>last</th><th>size</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
    <tfoot>
      <tr><td colspan="3">${apps.length} apps</td><td class="num"></td><td></td><td class="num">${humanBytes(totalBytes)}</td></tr>
    </tfoot>
  </table>
</body>
</html>
`;
}
