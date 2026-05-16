import { load, findApp, withRegistry } from '../core/registry.js';
import { snapshotEgress, addEgressAllow } from '../core/egress.js';
import { AppNotFoundError } from '../core/errors.js';
import { c, error, heading, info, success, table, warn } from '../ui/output.js';

export async function egressCommand(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'observe': return egressObserve(args.slice(1));
    case 'show':    return egressShow(args.slice(1));
    case 'allow':   return egressAllow(args.slice(1));
    default:
      error('Usage: fleet egress <observe|show|allow> ...');
      error('  observe <app>          take a snapshot of current outbound flows');
      error('  show <app>             show configured allowlist + observed flows');
      error('  allow <app> <host>     add a host to the allowlist');
      error('Note: enforce mode (actual drop) is deferred to Phase E. v1 is observe-only.');
      process.exit(1);
  }
}

function egressObserve(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));
  if (!appName) {
    error('Usage: fleet egress observe <app>');
    process.exit(1);
  }
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  const snap = snapshotEgress(app);

  if (json) {
    process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
    return;
  }

  heading(`Egress snapshot: ${app.name}`);
  info(`Taken: ${snap.takenAt}`);
  info(`Distinct remote endpoints: ${snap.uniqueRemotes.length}`);
  if (snap.uniqueRemotes.length === 0) {
    info('No outbound flows visible right now (containers may be idle).');
    return;
  }

  // Dedupe per (container, remote)
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const f of snap.flows) {
    const key = `${f.container}|${f.remote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const status = f.allowed
      ? `${c.green}allowed${c.reset}`
      : `${c.yellow}not in allowlist${c.reset}`;
    rows.push([f.container, f.remote, status]);
  }
  table(['CONTAINER', 'REMOTE', 'STATUS'], rows);
  process.stdout.write('\n');

  if (snap.violations.length > 0) {
    warn(`${snap.violations.length} non-private destination(s) NOT in allowlist:`);
    for (const v of snap.violations) process.stdout.write(`  - ${v}\n`);
    info(`Add to allowlist: fleet egress allow ${app.name} <host>`);
  } else {
    success('All non-private destinations are allowed (or allowlist not yet seeded).');
  }
}

function egressShow(args: string[]): void {
  const appName = args.find(a => !a.startsWith('-'));
  if (!appName) {
    error('Usage: fleet egress show <app>');
    process.exit(1);
  }
  const reg = load();
  const app = findApp(reg, appName);
  if (!app) throw new AppNotFoundError(appName);

  heading(`Egress config: ${app.name}`);
  info(`Mode: ${app.egress?.mode ?? 'observe (default)'}`);
  const allow = app.egress?.allow ?? [];
  if (allow.length === 0) {
    info('Allowlist: (empty — every external destination would be flagged)');
    info(`Seed it: fleet egress observe ${app.name}, then fleet egress allow ${app.name} <host>`);
  } else {
    info(`Allowlist (${allow.length}):`);
    for (const a of allow) process.stdout.write(`  - ${a}\n`);
  }
  info('Note: v1 is observe/shadow only — no packets are actually dropped.');
}

async function egressAllow(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'));
  const [appName, host] = positional;
  if (!appName || !host) {
    error('Usage: fleet egress allow <app> <host[:port] | *.host | cidr>');
    process.exit(1);
  }
  let entryCount = 0;
  await withRegistry(reg => {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    const updated = addEgressAllow(app, host);
    entryCount = updated.length;
    return reg;
  });
  success(`${appName} allow → ${host}  (now ${entryCount} entries)`);
}
