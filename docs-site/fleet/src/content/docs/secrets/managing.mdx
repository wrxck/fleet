---
title: Managing Secrets
description: How to create, update, delete, and inspect secrets
---

import { Aside } from '@astrojs/starlight/components';

All secrets commands require **root** (`sudo`).

## Initialise the vault

```bash
sudo fleet secrets init
```

Creates `/etc/fleet/age.key` and `vault/` directory. Outputs the public key.

## List apps with secrets

```bash
sudo fleet secrets list
```

Shows each app with its secret type, key count, and last sealed timestamp. Key counts show the number of entries without revealing names.

## Set a secret

```bash
sudo fleet secrets set myapp DATABASE_URL "postgres://user:pass@host/db"
```

Decrypts the app's vault file, adds or updates the key, re-encrypts, and updates the manifest. The secret key is validated against `^[a-zA-Z_][a-zA-Z0-9_]*$` to prevent injection.

## Get a secret

```bash
sudo fleet secrets get myapp DATABASE_URL
```

Decrypts and outputs the value for a single key.

## Import from file

```bash
sudo fleet secrets import myapp /path/to/.env
```

Reads the plaintext file, encrypts it into the vault, and removes the original.

## Export

```bash
sudo fleet secrets export myapp /path/to/output.env
```

Decrypts and writes the plaintext to the specified path.

<Aside type="caution">
Exported files are plaintext. Delete them after use.
</Aside>

## Seal and unseal

```bash
# Decrypt secrets to runtime
sudo fleet secrets unseal

# Remove runtime copies
sudo fleet secrets seal
```

**Unseal** validates all entries before writing to `/run/fleet-secrets/`. If validation fails, no files are written.

**Seal** removes the runtime directory contents.

## Validate

```bash
sudo fleet secrets validate
```

Cross-references vault contents against Docker Compose `secrets:` blocks. Reports missing or extra secrets per app.

## Status

```bash
sudo fleet secrets status
```

Shows vault initialisation state, seal status, and per-app summary.

## Drift detection

```bash
sudo fleet secrets drift
```

Compares vault contents against runtime files. Reports one of three statuses per app:

- **in-sync** — vault and runtime match
- **drifted** — runtime has been modified since unsealing
- **missing-runtime** — vault has secrets but runtime is empty (sealed)

Uses timing-safe comparison to prevent side-channel leaks.

## Restore from backup

```bash
sudo fleet secrets restore myapp
```

The safe seal operations create automatic backups before modifying vault files. If a seal fails, use restore to roll back to the previous version.

## Rotate the key

```bash
sudo fleet secrets rotate
```

Generates a new age key, re-encrypts all vault files, and updates the key file. The old key is removed.
