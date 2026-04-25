/**
 * Per-secret metadata: read/write helpers around the optional `secrets` map
 * on each ManifestEntry. Backwards-compatible: missing entries default to
 * `lastRotated = entry.lastSealedAt`, provider derived via classifySecret.
 */

import { loadManifest, saveManifest, listSecrets, type SecretMetadata } from './secrets.js';
import {
  classifySecret,
  getProviderById,
  ageInDays,
  isStale,
  type ProviderDef,
} from './secrets-providers.js';
import { SecretsError } from './errors.js';

export interface EnrichedSecret {
  /** The env var (or filename for secrets-dir apps). */
  name: string;
  /** Masked value preview, e.g. "sk_***" — never the real value. */
  maskedValue: string;
  /** ISO timestamp of last rotation, or last seal if never rotated individually. */
  lastRotated: string;
  /** Days since lastRotated. Null if timestamps invalid. */
  ageDays: number | null;
  /** Resolved provider definition. May be null if unrecognised. */
  provider: ProviderDef | null;
  /** True if older than provider's rotationFrequencyDays. */
  stale: boolean;
}

/** Get raw metadata for a single secret. Returns null if no per-secret entry exists. */
export function getSecretMetadata(app: string, secretName: string): SecretMetadata | null {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry || !entry.secrets) return null;
  return entry.secrets[secretName] ?? null;
}

/** Persist metadata for a single secret. Creates the secrets map if missing. */
export function setSecretMetadata(
  app: string,
  secretName: string,
  meta: SecretMetadata,
): void {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) throw new SecretsError(`No app in manifest: ${app}`);
  entry.secrets = entry.secrets ?? {};
  entry.secrets[secretName] = meta;
  saveManifest(manifest);
}

/** Mark a secret as freshly rotated. Auto-classifies provider if not specified. */
export function markRotated(
  app: string,
  secretName: string,
  opts: { strategy?: SecretMetadata['strategy']; notes?: string } = {},
): SecretMetadata {
  const provider = classifySecret(secretName);
  const meta: SecretMetadata = {
    lastRotated: new Date().toISOString(),
    provider: provider?.id,
    strategy: opts.strategy ?? provider?.strategy,
    notes: opts.notes,
  };
  setSecretMetadata(app, secretName, meta);
  return meta;
}

/**
 * List all secrets in an app, enriched with provider metadata + age + staleness.
 * Backwards-compatible: secrets without per-secret metadata fall back to lastSealedAt.
 */
export function enumerateSecrets(app: string): EnrichedSecret[] {
  const manifest = loadManifest();
  const entry = manifest.apps[app];
  if (!entry) throw new SecretsError(`No app in manifest: ${app}`);

  const items = listSecrets(app); // already returns { key, maskedValue }
  const fallbackTs = entry.lastSealedAt;

  return items.map(({ key, maskedValue }) => {
    const stored = entry.secrets?.[key];
    const provider: ProviderDef | null =
      (stored?.provider ? getProviderById(stored.provider) : null) ?? classifySecret(key);
    const lastRotated = stored?.lastRotated ?? fallbackTs;
    const ageDays = ageInDays(lastRotated);
    return {
      name: key,
      maskedValue,
      lastRotated,
      ageDays,
      provider,
      stale: isStale(ageDays, provider),
    };
  });
}

/** All apps × all secrets, enriched. Used by `ages` (no app), MOTD, and bulk reports. */
export function enumerateAllSecrets(): Array<EnrichedSecret & { app: string }> {
  const manifest = loadManifest();
  const out: Array<EnrichedSecret & { app: string }> = [];
  for (const app of Object.keys(manifest.apps)) {
    try {
      for (const s of enumerateSecrets(app)) out.push({ app, ...s });
    } catch {
      // App may be sealed-but-unreadable (e.g. key missing). Skip silently —
      // the caller's job to report on overall vault health, not ours.
    }
  }
  return out;
}
