/**
 * Rotation engine: takes a parsed plaintext env, applies a per-secret rotation
 * (immediate, dual-mode, etc.), re-seals, restarts the service, runs a health
 * gate, and rolls back on failure. Pure functions where possible — I/O isolated
 * to thin wrappers so tests can run without a real vault.
 */

import { decryptApp, sealApp, loadManifest, lockManifest, type Manifest } from './secrets.js';
import { snapshotApp, restoreSnapshot } from './secrets-snapshots.js';
import { auditLog } from './secrets-audit.js';
import { markRotated } from './secrets-metadata.js';
import { classifySecret, type ProviderDef } from './secrets-providers.js';
import { SecretsError } from './errors.js';

/** Mask a NEW (just-entered) secret value for confirmation display. */
export function maskNewValue(value: string): string {
  if (value.length <= 4) return `*** (${value.length} chars)`;
  if (value.length <= 12) return `${value.slice(0, 2)}***${value.slice(-2)} (${value.length} chars)`;
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

/** Validate against provider format if any. Returns null on pass, error string on fail. */
export function validateFormat(value: string, provider: ProviderDef | null): string | null {
  if (!provider?.format) return null;
  if (provider.format.test(value)) return null;
  return `Value does not match ${provider.name} format (${provider.format.source})`;
}

/** Reject obvious placeholders / low-entropy strings. */
export function checkEntropy(value: string): string | null {
  const lower = value.toLowerCase().trim();
  const placeholders = [
    'todo', 'changeme', 'change-me', 'change_me', 'placeholder',
    'password', 'secret', 'changethis', 'change-this',
    'foo', 'bar', 'baz', 'test', 'example', 'xxx', 'yyy', 'zzz',
    'replace_me', 'replace-me', 'fixme',
  ];
  if (placeholders.includes(lower)) {
    // Don't echo the rejected value — even an obvious placeholder might be
    // an unintended paste of a real secret that just happened to start with
    // a placeholder substring.
    return `Value looks like a placeholder, not a real secret`;
  }
  if (value.length < 8) {
    return `Value too short (${value.length} chars) — secrets should be ≥ 8 chars`;
  }
  if (/^(.)\1+$/.test(value)) {
    return `Value is all the same character`;
  }
  return null;
}

/**
 * Parse an .env-style plaintext into ordered entries. Preserves comments
 * and blank lines so a re-serialised file is diff-friendly.
 */
export type EnvLine =
  | { kind: 'kv'; key: string; value: string }
  | { kind: 'raw'; text: string };

export function parseEnv(plaintext: string): EnvLine[] {
  const lines: EnvLine[] = [];
  for (const raw of plaintext.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      lines.push({ kind: 'raw', text: raw });
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq < 0) {
      lines.push({ kind: 'raw', text: raw });
      continue;
    }
    lines.push({ kind: 'kv', key: raw.substring(0, eq), value: raw.substring(eq + 1) });
  }
  return lines;
}

export function serialiseEnv(lines: EnvLine[]): string {
  return lines
    .map(l => (l.kind === 'kv' ? `${l.key}=${l.value}` : l.text))
    .join('\n');
}

/**
 * Apply a single secret update. For dual-mode strategies, the OLD value is
 * preserved as <NAME>_PREVIOUS so the app can verify legacy tokens during
 * the grace period. Returns the new env content.
 */
export function applyRotation(
  plaintext: string,
  key: string,
  newValue: string,
  strategy: 'immediate' | 'dual-mode' | 'at-rest-key' | 'user-issued',
): string {
  const lines = parseEnv(plaintext);
  const idx = lines.findIndex(l => l.kind === 'kv' && l.key === key);
  if (idx < 0) throw new SecretsError(`Key not found in env: ${key}`);
  const existing = lines[idx];
  if (existing.kind !== 'kv') throw new SecretsError('Internal: kv expected');

  if (strategy === 'dual-mode') {
    const prevKey = `${key}_PREVIOUS`;
    const oldValue = existing.value;
    // Replace primary with new value
    lines[idx] = { kind: 'kv', key, value: newValue };
    // Insert/update the _PREVIOUS line right after the primary
    const prevIdx = lines.findIndex(l => l.kind === 'kv' && l.key === prevKey);
    if (prevIdx >= 0) {
      lines[prevIdx] = { kind: 'kv', key: prevKey, value: oldValue };
    } else {
      lines.splice(idx + 1, 0, { kind: 'kv', key: prevKey, value: oldValue });
    }
  } else {
    lines[idx] = { kind: 'kv', key, value: newValue };
  }

  return serialiseEnv(lines);
}

export interface RotationResult {
  app: string;
  key: string;
  strategy: string;
  snapshot: string;
  rolledBack: boolean;
  reason?: string;
}

/**
 * Full rotation pipeline. Caller is expected to have already collected and
 * validated the new value via the interactive prompts. This orchestrates
 * snapshot → seal → audit. Restart + health-gate are caller's responsibility
 * (we want the engine pure-ish so it's easy to test).
 */
export async function performRotation(
  app: string,
  key: string,
  newValue: string,
  opts: { dryRun?: boolean; notes?: string; dataMigrated?: boolean } = {},
): Promise<RotationResult> {
  // Hold the manifest lock for the whole snapshot → seal → markRotated cycle
  // so a concurrent CLI/cron writer can't slip a stale write between our
  // seal and our metadata stamp. markRotated calls saveManifest internally;
  // that write happens under our lock.
  return await lockManifest(() => {
    const manifest: Manifest = loadManifest();
    const entry = manifest.apps[app];
    if (!entry) throw new SecretsError(`No app in manifest: ${app}`);
    if (entry.type !== 'env') {
      throw new SecretsError(`Rotation only supports env-type apps, got ${entry.type}`);
    }

    const provider = classifySecret(key);
    const strategy = provider?.strategy ?? 'immediate';

    if (strategy === 'user-issued') {
      throw new SecretsError(
        `${key} is a user-issued token. Rotating yours doesn't help — invalidate per-user instead.`,
      );
    }
    // Strict typed opt — was previously a substring match on opts.notes which
    // could be bypassed by any caller embedding the flag in free-text notes.
    if (strategy === 'at-rest-key' && !opts.dataMigrated) {
      throw new SecretsError(
        `${key} encrypts data at rest. Re-encrypt your data first, then pass --data-migrated.`,
      );
    }

    if (opts.dryRun) {
      auditLog({ op: 'rotate-attempted', app, secret: key, ok: true, details: 'dry-run' });
      return { app, key, strategy, snapshot: '(dry-run)', rolledBack: false };
    }

    // 1. Snapshot before any change.
    const snapshot = snapshotApp(app);
    auditLog({ op: 'snapshot', app, secret: key, ok: true, details: snapshot });

    try {
      // 2. Decrypt, apply rotation, re-encrypt.
      const plaintext = decryptApp(app);
      const updated = applyRotation(plaintext, key, newValue, strategy);
      sealApp(app, updated, entry.sourceFile);

      // 3. Stamp metadata.
      markRotated(app, key, { strategy, notes: opts.notes });

      auditLog({ op: 'rotate', app, secret: key, ok: true, details: `strategy=${strategy}` });
      return { app, key, strategy, snapshot, rolledBack: false };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      // Restore from snapshot on any failure.
      try {
        restoreSnapshot(app);
        auditLog({ op: 'rollback', app, secret: key, ok: true, details: `auto: ${reason}` });
      } catch (rollbackErr) {
        auditLog({
          op: 'rollback',
          app,
          secret: key,
          ok: false,
          details: `auto rollback also failed: ${rollbackErr}`,
        });
      }
      auditLog({ op: 'rotate-failed', app, secret: key, ok: false, details: reason });
      return { app, key, strategy, snapshot, rolledBack: true, reason };
    }
  });
}
