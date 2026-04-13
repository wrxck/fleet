---
title: Safety Features
description: Backup, validation, drift detection, and safe seal operations
---

import { Aside } from '@astrojs/starlight/components';

Fleet's secrets system includes multiple safety mechanisms to prevent accidental data loss.

## Pre-seal validation

Before re-encrypting secrets, `validateBeforeSeal` compares the new content against the existing vault:

```
Added:     NEW_KEY
Removed:   OLD_KEY
Unchanged: DATABASE_URL, API_KEY, SECRET_TOKEN
```

**The >50% rule**: if more than 50% of existing keys would be removed, the seal is rejected. This prevents accidental bulk deletion (e.g., sealing an empty file over a full vault).

```typescript
const removedRatio = removed.length / (removed.length + unchanged.length);
if (removedRatio > 0.5) {
  throw new SecretsError(
    `Refusing to seal: would remove ${removed.length} of ${total} keys (>50%)`
  );
}
```

## Automatic backups

The `safeSealApp` and `safeSealDbSecrets` functions follow a validate-backup-seal-cleanup pattern:

1. **Validate** — run pre-seal validation (cheap, no I/O wasted if it fails)
2. **Backup** — copy the existing `.age` file to `.age.bak`
3. **Seal** — encrypt the new content
4. **Cleanup** — remove the backup on success

If step 3 fails, the backup is automatically restored:

```typescript
const validation = validateBeforeSeal(app, content);
backupVaultFile(app);
try {
  sealApp(app, content, sourceFile);
  removeBackup(app);
} catch (err) {
  restoreVaultFile(app);
  throw err;
}
return validation;
```

## Unseal validation

`unsealAll` validates every vault entry **before** writing any files to runtime:

1. Decrypt all vault files
2. Validate all entries
3. Only if all pass, write to `/run/fleet-secrets/`

This prevents partial unsealing where some apps get secrets and others don't.

## Drift detection

`detectDrift` compares vault contents against runtime using timing-safe equality:

```typescript
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
```

This prevents timing side-channel attacks that could leak information about secret contents through response time differences.

Three possible results per app:
- **in-sync** — vault decrypts to the same content as runtime
- **drifted** — runtime was modified since last unseal
- **missing-runtime** — no runtime files exist (vault is sealed)

## Input validation

Secret keys are validated against `^[a-zA-Z_][a-zA-Z0-9_]*$`:
- Must start with a letter or underscore
- Only alphanumeric characters and underscores
- Prevents shell injection via key names

File paths are checked for traversal (`../`) attacks. App names are validated against a strict pattern.

## Directory permissions

| Path | Mode | Purpose |
|------|------|---------|
| `/etc/fleet/` | `0700` | Key directory (root only) |
| `/etc/fleet/age.key` | `0600` | Encryption key (root read-only) |
| `/run/fleet-secrets/<app>/` | `0700` | Runtime secrets directory |
| `.env` files | `0600` | Environment files |

<Aside>
Runtime secrets live on tmpfs (`/run/`), so they're automatically cleared on reboot. The `fleet-unseal.service` systemd unit re-decrypts them on boot before app services start.
</Aside>
