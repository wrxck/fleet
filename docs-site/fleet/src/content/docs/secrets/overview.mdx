---
title: Secrets Vault Overview
description: How fleet encrypts and manages secrets with age
---

import { Aside } from '@astrojs/starlight/components';

Fleet includes an encrypted secrets vault that uses [age](https://github.com/FiloSottile/age) encryption. Secrets are encrypted at rest in the vault and decrypted to a tmpfs mount at runtime.

## Architecture

```
/etc/fleet/age.key          ← encryption key (root-only, 0600)
vault/manifest.json         ← tracks which apps have secrets
vault/<app>.age             ← encrypted secret files
/run/fleet-secrets/<app>/   ← decrypted runtime secrets (tmpfs)
```

## Key concepts

**Vault** — the `vault/` directory in the fleet installation. Contains age-encrypted files and a manifest. This directory is gitignored — secrets never enter version control.

**Manifest** — `vault/manifest.json` tracks metadata for each app's secrets:
```json
{
  "version": 1,
  "apps": {
    "myapp": {
      "type": "env",
      "encryptedFile": "myapp.age",
      "sourceFile": ".env",
      "lastSealedAt": "2026-04-13T10:00:00Z",
      "keyCount": 12
    }
  }
}
```

**Seal** — encrypt plaintext secrets into the vault. The plaintext is removed.

**Unseal** — decrypt vault files to `/run/fleet-secrets/` where containers can read them.

## Secret types

### env (environment file)

Standard `.env` format. Unsealed as `/run/fleet-secrets/<app>/.env`:

```
DATABASE_URL=postgres://...
API_KEY=sk-...
```

### secrets-dir (individual files)

Multiple secret files bundled together. Unsealed as individual files in `/run/fleet-secrets/<app>/secrets/`:

```
/run/fleet-secrets/myapp/secrets/db-password
/run/fleet-secrets/myapp/secrets/api-key
/run/fleet-secrets/myapp/secrets/tls.crt
```

This is useful for Docker secrets or apps that read secrets from individual files.

## Encryption

Fleet uses age symmetric encryption with the key at `/etc/fleet/age.key`:

- Key is generated with `age-keygen` during `fleet secrets init`
- Key file permissions are `0600` (root read-only)
- Key directory (`/etc/fleet/`) is `0700`
- Runtime directory permissions are `0700` (secrets-dir files are `0600`)

<Aside type="caution">
The age key is the single point of trust. Back it up securely — if lost, all vault contents are unrecoverable.
</Aside>

## Lifecycle

1. **Init** — `fleet secrets init` creates the key and vault directory
2. **Import/Set** — add secrets to the vault (encrypts immediately)
3. **Unseal** — decrypt to runtime before starting apps
4. **Runtime** — containers read from `/run/fleet-secrets/`
5. **Seal** — remove runtime copies when shutting down

See [Managing Secrets](/secrets/managing/) for the full command reference.
