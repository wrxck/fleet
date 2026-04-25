/**
 * Egress observation: see where each app's containers are talking to.
 *
 * v1 = snapshot mode. Reads conntrack via `ss -tn` filtered by container IPs,
 * resolves remote IPs to hostnames best-effort, returns the deduplicated set.
 *
 * v2 (Phase E) = continuous shadow daemon (eBPF-based or nftables LOG target),
 * with persistent observed-set storage and a real `enforce` mode that drops
 * packets to non-allowlisted destinations. Design intentionally matches v1's
 * data shape so the upgrade is non-breaking.
 */

import { execSafe } from './exec.js';
import type { AppEntry } from './registry.js';

export interface EgressFlow {
  /** App that owns the source container. */
  app: string;
  /** Container name. */
  container: string;
  /** Remote endpoint as host:port. Hostname resolved when possible. */
  remote: string;
  remoteIp: string;
  remotePort: number;
  /** True if remote matches the app's egress.allow list. */
  allowed: boolean;
}

export interface EgressSnapshot {
  takenAt: string;
  app: string;
  flows: EgressFlow[];
  /** Distinct (host:port) destinations observed. Useful for seeding allow lists. */
  uniqueRemotes: string[];
  /** uniqueRemotes that aren't on the app's allow list. */
  violations: string[];
}

/** Container PID for entering its network namespace. Returns 0 if not running. */
function containerPid(container: string): number {
  const r = execSafe('docker', ['inspect', '--format={{.State.Pid}}', container]);
  if (!r.ok) return 0;
  return parseInt(r.stdout.trim(), 10) || 0;
}

/** Run `ss -tnH` inside a container's network namespace. Requires sudo (nsenter
 * needs CAP_SYS_ADMIN). Returns empty string if the call fails. */
function nsenterSs(pid: number): string {
  const r = execSafe('nsenter', ['-t', String(pid), '-n', 'ss', '-tnH']);
  if (r.ok) return r.stdout;
  // Fall back to sudo (fleet might be running unprivileged)
  const s = execSafe('sudo', ['-n', 'nsenter', '-t', String(pid), '-n', 'ss', '-tnH']);
  return s.ok ? s.stdout : '';
}

/** Reverse-lookup an IP → hostname. Best-effort, short timeout. */
function reverseLookup(ip: string): string | null {
  // Try `getent hosts` first (uses /etc/hosts + resolver)
  const r = execSafe('getent', ['hosts', ip]);
  if (r.ok && r.stdout.trim()) {
    const parts = r.stdout.trim().split(/\s+/);
    if (parts[1]) return parts[1];
  }
  // Fall back to `dig +short -x`
  const dig = execSafe('dig', ['+short', '+time=1', '+tries=1', '-x', ip]);
  if (dig.ok && dig.stdout.trim()) {
    return dig.stdout.trim().replace(/\.$/, '').split('\n')[0];
  }
  return null;
}

const RFC1918 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^127\./, /^169\.254\./, /^::1$/, /^fe80:/];
function isPrivate(ip: string): boolean {
  return RFC1918.some(r => r.test(ip));
}

/**
 * Read all current outbound TCP/UDP flows from the host using `ss -tnp`,
 * filter to those whose SOURCE matches one of the app's container IPs.
 * Connections to private addresses are kept (they may indicate intra-host
 * leaks) but flagged differently.
 */
export function snapshotEgress(app: AppEntry): EgressSnapshot {
  const allFlows: EgressFlow[] = [];
  const allow = new Set(app.egress?.allow ?? []);

  for (const ct of app.containers) {
    const pid = containerPid(ct);
    if (pid === 0) continue;
    const out = nsenterSs(pid);
    if (!out) continue;

    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const peer = cols[4];
      const peerMatch = peer.match(/^(.+):(\d+)$/);
      if (!peerMatch) continue;
      const remoteIp = peerMatch[1].replace(/^\[|\]$/g, '');
      const remotePort = parseInt(peerMatch[2], 10);
      // Skip listeners back to ourselves and intra-pod chatter
      if (isPrivate(remoteIp) && (remoteIp === '127.0.0.1' || remoteIp === '::1')) continue;
      const host = reverseLookup(remoteIp) ?? remoteIp;
      const remote = `${host}:${remotePort}`;
      const allowed = allowMatches(allow, remote, host, remoteIp, remotePort);
      allFlows.push({ app: app.name, container: ct, remote, remoteIp, remotePort, allowed });
    }
  }
  if (allFlows.length === 0) {
    return { takenAt: new Date().toISOString(), app: app.name, flows: [], uniqueRemotes: [], violations: [] };
  }

  const uniq = Array.from(new Set(allFlows.map(f => f.remote))).sort();
  const violations = uniq.filter(r => {
    const flow = allFlows.find(f => f.remote === r);
    return flow ? !flow.allowed && !isPrivate(flow.remoteIp) : false;
  });

  return {
    takenAt: new Date().toISOString(),
    app: app.name,
    flows: allFlows,
    uniqueRemotes: uniq,
    violations,
  };
}

function allowMatches(allow: Set<string>, remote: string, host: string, ip: string, port: number): boolean {
  if (allow.size === 0) return false;
  // Exact host:port
  if (allow.has(remote)) return true;
  // Bare host (any port)
  if (allow.has(host)) return true;
  // Bare ip
  if (allow.has(ip)) return true;
  // host:port without numeric port lookup: check 'host:*'
  if (allow.has(`${host}:*`)) return true;
  // Domain-suffix matching (`*.stripe.com` allows `api.stripe.com`)
  for (const a of allow) {
    if (a.startsWith('*.') && (host.endsWith(a.slice(1)) || host === a.slice(2))) return true;
    if (a.endsWith(`:${port}`) && (host === a.slice(0, -port.toString().length - 1) || ip === a.slice(0, -port.toString().length - 1))) return true;
  }
  return false;
}

export function addEgressAllow(app: AppEntry, host: string): string[] {
  const cur = new Set(app.egress?.allow ?? []);
  cur.add(host);
  app.egress = { ...(app.egress ?? {}), allow: Array.from(cur).sort() };
  return app.egress.allow!;
}
