import { existsSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';

import { credentialPathFor } from './secrets-v2-creds.js';
import { execSafe } from './exec.js';
import { loadManifest } from './secrets.js';

export interface V2DriftCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface V2DriftResult {
  app: string;
  ok: boolean;
  checks: V2DriftCheck[];
}

const AGE_PUBKEY_RE = /^age1[a-z0-9]+$/;

function checkRecipient(recipient: string | undefined): V2DriftCheck {
  if (!recipient || !AGE_PUBKEY_RE.test(recipient)) {
    return {
      name: 'recipient_matches',
      ok: false,
      detail: `invalid age public key format: ${recipient ?? '(missing)'}`,
    };
  }
  return {
    name: 'recipient_matches',
    ok: true,
    detail: 'format only — full cryptographic check requires running agent',
  };
}

function checkCredentialPresent(app: string): V2DriftCheck {
  const credPath = credentialPathFor(app);
  const present = existsSync(credPath);
  return {
    name: 'credential_present',
    ok: present,
    detail: present ? undefined : `not found: ${credPath}`,
  };
}

function checkAgentActive(app: string): V2DriftCheck {
  const unit = `fleet-secrets-agent@${app}.service`;
  const result = execSafe('systemctl', ['is-active', unit]);
  const active = result.stdout.trim() === 'active';
  return {
    name: 'agent_active',
    ok: active,
    detail: active ? undefined : `systemctl is-active: ${result.stdout.trim() || result.stderr.trim()}`,
  };
}

function checkSocketPresent(socketPath: string): V2DriftCheck {
  const present = existsSync(socketPath);
  return {
    name: 'socket_present',
    ok: present,
    detail: present ? undefined : `not found: ${socketPath}`,
  };
}

function checkSocketPerms(socketPath: string): V2DriftCheck {
  try {
    const st = statSync(socketPath);
    const perms = st.mode & 0o777;
    const correct = perms === 0o660;
    return {
      name: 'socket_perms',
      ok: correct,
      detail: correct ? undefined : `expected 0o660, got 0o${perms.toString(8)}`,
    };
  } catch (err) {
    return {
      name: 'socket_perms',
      ok: false,
      detail: `statSync failed: ${(err as Error).message}`,
    };
  }
}

function fetchFromSocket(socketPath: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    let response = '';

    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      reject(new Error('socket fetch timed out'));
    });

    sock.on('error', (err) => reject(err));

    sock.on('connect', () => {
      sock.write('GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });

    sock.on('data', (chunk) => { response += chunk.toString(); });

    sock.on('end', () => resolve(response));

    sock.on('close', () => {
      if (response) resolve(response);
    });
  });
}

function parseJsonBody(raw: string): unknown {
  const sep = raw.indexOf('\r\n\r\n');
  const body = sep === -1 ? raw : raw.slice(sep + 4);
  return JSON.parse(body.trim());
}

async function checkSampleFetchKeys(app: string, socketPath: string, keyCount: number): Promise<V2DriftCheck> {
  try {
    const raw = await fetchFromSocket(socketPath);
    const data = parseJsonBody(raw) as Record<string, unknown>;

    if (data.app !== app) {
      return {
        name: 'sample_fetch_keys',
        ok: false,
        detail: `app mismatch: expected '${app}', got '${String(data.app)}'`,
      };
    }

    const secrets = typeof data.secrets === 'number' ? data.secrets : -1;
    if (keyCount > 0 && secrets <= 0) {
      return {
        name: 'sample_fetch_keys',
        ok: false,
        detail: `expected secrets > 0, got ${secrets}`,
      };
    }

    return { name: 'sample_fetch_keys', ok: true };
  } catch (err) {
    return {
      name: 'sample_fetch_keys',
      ok: false,
      detail: (err as Error).message,
    };
  }
}

export async function detectV2Drift(
  app: string,
  socketPathOverride?: string,
): Promise<V2DriftResult> {
  const manifest = loadManifest();
  const entry = manifest.apps[app];

  if (!entry || entry.mode !== 'socket') {
    return {
      app,
      ok: false,
      checks: [{ name: 'mode', ok: false, detail: 'app not in v2 mode' }],
    };
  }

  const socketPath = socketPathOverride ?? `/run/fleet-secrets/${app}.sock`;

  const checks: V2DriftCheck[] = [
    checkRecipient(entry.recipient),
    checkCredentialPresent(app),
    checkAgentActive(app),
    checkSocketPresent(socketPath),
    checkSocketPerms(socketPath),
    await checkSampleFetchKeys(app, socketPath, entry.keyCount),
  ];

  return {
    app,
    ok: checks.every(c => c.ok),
    checks,
  };
}
