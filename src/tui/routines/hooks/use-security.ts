import { existsSync, statSync } from 'node:fs';
import { useEffect, useState } from 'react';

import type { AppEntry } from '@/core/registry.js';
import { execSafe } from '@/core/exec.js';

const SSH_AUTH_SOCK_PATH = '/tmp/fleet-ssh-agent.sock';
const GUARDIAN_WHITELIST = '/etc/guardian/whitelist';

export interface GuardianStatus {
  binaryInstalled: boolean;
  whitelistExists: boolean;
  whitelistLines: number | null;
  runcWhitelisted: boolean | null;
}

export interface SshAgentStatus {
  socketExists: boolean;
  keyLoaded: boolean | null;
  keyFingerprint: string | null;
}

export interface CertExpiry {
  domain: string;
  expiresAt: string | null;
  daysUntil: number | null;
}

export interface SecretAge {
  app: string;
  ageDays: number | null;
  error: string | null;
}

export interface SecuritySnapshot {
  loading: boolean;
  guardian: GuardianStatus | null;
  ssh: SshAgentStatus | null;
  certs: CertExpiry[];
  secretAges: SecretAge[];
  refreshedAt: number;
}

function checkGuardian(): GuardianStatus {
  const binary = existsSync('/usr/local/bin/guardiand');
  const whitelistExists = existsSync(GUARDIAN_WHITELIST);
  let whitelistLines: number | null = null;
  let runcWhitelisted: boolean | null = null;
  if (whitelistExists) {
    const res = execSafe('bash', ['-c', `wc -l < ${GUARDIAN_WHITELIST} && grep -c '^/runc$' ${GUARDIAN_WHITELIST}`], { timeout: 3000 });
    if (res.ok) {
      const lines = res.stdout.split('\n').map(s => parseInt(s.trim(), 10));
      whitelistLines = Number.isFinite(lines[0]) ? lines[0] : null;
      runcWhitelisted = lines[1] ? lines[1] > 0 : false;
    }
  }
  return { binaryInstalled: binary, whitelistExists, whitelistLines, runcWhitelisted };
}

function checkSshAgent(): SshAgentStatus {
  const socketExists = existsSync(SSH_AUTH_SOCK_PATH);
  if (!socketExists) return { socketExists: false, keyLoaded: null, keyFingerprint: null };
  const res = execSafe('ssh-add', ['-l'], {
    env: { SSH_AUTH_SOCK: SSH_AUTH_SOCK_PATH },
    timeout: 3000,
  });
  if (!res.ok || !res.stdout) return { socketExists: true, keyLoaded: false, keyFingerprint: null };
  const line = res.stdout.split('\n')[0] ?? '';
  const fp = line.split(/\s+/)[1] ?? null;
  return { socketExists: true, keyLoaded: true, keyFingerprint: fp };
}

function certExpiryFor(domain: string): CertExpiry {
  const paths = [
    `/etc/letsencrypt/live/${domain}/fullchain.pem`,
    `/etc/nginx/ssl/${domain}/fullchain.pem`,
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const res = execSafe('openssl', ['x509', '-enddate', '-noout', '-in', path], { timeout: 3000 });
    if (!res.ok) continue;
    const m = res.stdout.match(/notAfter=(.+)/);
    if (!m) continue;
    const expiresAt = new Date(m[1]);
    if (isNaN(expiresAt.getTime())) continue;
    const daysUntil = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
    return { domain, expiresAt: expiresAt.toISOString(), daysUntil };
  }
  return { domain, expiresAt: null, daysUntil: null };
}

function secretAgeFor(app: AppEntry): SecretAge {
  const secretsPath = `${app.composePath}/secrets/vault.age`;
  if (!existsSync(secretsPath)) return { app: app.name, ageDays: null, error: 'no vault.age' };
  try {
    const stat = statSync(secretsPath);
    const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86_400_000);
    return { app: app.name, ageDays, error: null };
  } catch (err) {
    return { app: app.name, ageDays: null, error: (err as Error).message };
  }
}

export function useSecurity(apps: AppEntry[]): SecuritySnapshot & { refresh(): void } {
  const [state, setState] = useState<SecuritySnapshot>({
    loading: false,
    guardian: null,
    ssh: null,
    certs: [],
    secretAges: [],
    refreshedAt: 0,
  });

  const load = (): void => {
    setState(s => ({ ...s, loading: true }));

    const guardian = checkGuardian();
    const ssh = checkSshAgent();

    const domains = new Set<string>();
    for (const app of apps) for (const d of app.domains) domains.add(d);
    const certs: CertExpiry[] = [];
    for (const d of domains) certs.push(certExpiryFor(d));
    certs.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));

    const secretAges: SecretAge[] = apps
      .filter(a => a.secretsManaged)
      .map(secretAgeFor)
      .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

    setState({
      loading: false,
      guardian,
      ssh,
      certs,
      secretAges,
      refreshedAt: Date.now(),
    });
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [apps.map(a => a.name).join('|')]);

  return { ...state, refresh: load };
}
