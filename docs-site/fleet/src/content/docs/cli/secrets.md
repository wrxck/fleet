---
title: Secrets
description: Manage encrypted secrets with the fleet CLI
---

Fleet uses [age](https://github.com/FiloSottile/age) encryption for secrets at rest. Each app's secrets are stored as `.age` files in the `vault/` directory. On boot, `fleet-unseal.service` decrypts them to `/run/fleet-secrets/` (tmpfs — never touches persistent disk).

:::note[Root required]
All secrets commands require root privileges.
:::

:::caution[Vault safety]
Fleet protects against accidental wipes: seal operations create automatic backups, and reject seals that would remove more than 50% of existing keys. Use `fleet secrets restore` to revert a bad seal.
:::

---

## fleet secrets init

Initialise the secrets vault. Generates an age keypair at `/etc/fleet/age.key`, writes the public key to the manifest, and installs `fleet-unseal.service`.

### Usage

```bash
fleet secrets init
```

### Examples

```bash
$ fleet secrets init
✓ Vault initialised
  Public key: age1...
✓ Installed fleet-unseal.service
```

---

## fleet secrets list

Show managed secrets for one or all apps. Values are masked.

### Usage

```bash
fleet secrets list [app] [--json]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name. Omit to list all apps. |

### Examples

```bash
$ fleet secrets list myapp
Secrets: myapp (3)

KEY            VALUE
DATABASE_URL   ****...
API_KEY        ****...
SECRET_TOKEN   ****...
```

### Related

- **MCP tool:** `fleet_secrets_list`

---

## fleet secrets set

Set a single secret key/value for an app directly in the encrypted vault.

### Usage

```bash
fleet secrets set <app> <KEY> <VALUE>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |
| `KEY` | Yes | Secret key name |
| `VALUE` | Yes | Secret value |

### Examples

```bash
$ fleet secrets set myapp DATABASE_URL "postgres://user:pass@localhost/db"
✓ Set DATABASE_URL for myapp
```

### Related

- **MCP tool:** `fleet_secrets_set`

---

## fleet secrets get

Print a single decrypted secret value to stdout.

### Usage

```bash
fleet secrets get <app> <KEY>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |
| `KEY` | Yes | Secret key name |

### Examples

```bash
$ fleet secrets get myapp DATABASE_URL
postgres://user:pass@localhost/db
```

### Related

- **MCP tool:** `fleet_secrets_get`

---

## fleet secrets import

Import a `.env` file or a directory of secret files into the vault.

### Usage

```bash
fleet secrets import <app> [path]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |
| `path` | No | Path to `.env` file or secrets directory. Defaults to `<composePath>/.env`. |

### Examples

```bash
$ fleet secrets import myapp
✓ Imported 5 keys from /srv/myapp/.env
```

```bash
$ fleet secrets import myapp /srv/myapp/.env.production
✓ Imported 5 keys from /srv/myapp/.env.production
```

---

## fleet secrets export

Print the full decrypted `.env` for an app to stdout.

### Usage

```bash
fleet secrets export <app>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Examples

```bash
$ fleet secrets export myapp
DATABASE_URL=postgres://...
API_KEY=sk-...
SECRET_TOKEN=...
```

---

## fleet secrets seal

Re-encrypt the current runtime secrets (`/run/fleet-secrets/`) back to the vault. Backups are created automatically before any seal operation.

### Usage

```bash
fleet secrets seal [app]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name. Omit to seal all apps. |

### Examples

```bash
$ fleet secrets seal myapp
✓ Sealed myapp
```

```bash
$ fleet secrets seal
✓ Sealed myapp
✓ Sealed api
✓ Sealed worker
```

### Related

- **MCP tool:** `fleet_secrets_seal`

---

## fleet secrets unseal

Decrypt all vault files to `/run/fleet-secrets/`. This is run automatically on boot by `fleet-unseal.service`.

### Usage

```bash
fleet secrets unseal
```

### Examples

```bash
$ fleet secrets unseal
✓ Unsealed 3 apps to /run/fleet-secrets/
```

:::caution
This overwrites any runtime changes that were not sealed back to the vault. Run `fleet secrets drift` first to check for unsaved changes.
:::

### Related

- **MCP tool:** `fleet_secrets_unseal`

---

## fleet secrets rotate

Generate a new age keypair and re-encrypt all vault files with the new key.

### Usage

```bash
fleet secrets rotate [-y]
```

### Flags

| Flag | Description |
|------|-------------|
| `-y`, `--yes` | Skip confirmation prompt |

### Examples

```bash
$ fleet secrets rotate
? Rotate age key? This will re-encrypt all secrets. (y/N) y
✓ Key rotated
  Old: age1...
  New: age1...
  Re-encrypted 3 apps
! Run "fleet secrets unseal" to update runtime secrets
```

---

## fleet secrets validate

Check that all secret references in `docker-compose.yml` files have matching entries in the vault.

### Usage

```bash
fleet secrets validate [app] [--json]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name. Omit to validate all apps. |

### Examples

```bash
$ fleet secrets validate myapp
Secrets Validation
  ok  myapp
✓ All secrets validated
```

```bash
$ fleet secrets validate
Secrets Validation
✗ myapp: missing from vault: NEW_API_KEY
  api: extra in vault (not in compose): OLD_KEY
✗ 1 app(s) have missing secrets
```

### Related

- **MCP tool:** `fleet_secrets_validate`

---

## fleet secrets drift

Detect differences between the encrypted vault (persists across reboots) and the runtime at `/run/fleet-secrets/` (lost on reboot).

### Usage

```bash
fleet secrets drift [app] [--json]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App name. Omit to check all apps. |

### Examples

```bash
$ fleet secrets drift
Vault / Runtime Drift
  in-sync  myapp
✗ api: drifted
    added at runtime: NEW_KEY
    changed at runtime: API_SECRET
! Run "fleet secrets seal" to persist runtime changes to vault
! Run "fleet secrets unseal" to revert runtime to vault state
```

### Related

- **MCP tool:** `fleet_secrets_drift`

---

## fleet secrets restore

Restore the vault for an app from its automatically-created backup (`.bak` file).

### Usage

```bash
fleet secrets restore <app>
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | Yes | App name |

### Examples

```bash
$ fleet secrets restore myapp
✓ Restored vault backup for myapp
  Run "fleet secrets unseal" to apply to runtime
```

### Related

- **MCP tool:** `fleet_secrets_restore`

---

## fleet secrets status

Show overall vault state: initialisation status, sealed/unsealed, key path, app count, and total key count.

### Usage

```bash
fleet secrets status [--json]
```

### Examples

```bash
$ fleet secrets status
Secrets Status
  Vault: initialised
  State: unsealed
  Key:   /etc/fleet/age.key
  Vault: /path/to/vault
  Runtime: /run/fleet-secrets/
  Apps: 3 | Keys: 12
```

### Related

- **MCP tool:** `fleet_secrets_status`

---

## fleet secrets set

Set a single secret value for an app. **Interactive paste is the default** — the secret value is never accepted as a positional argv argument because process arguments are world-readable via `/proc/<pid>/cmdline` and land in shell history.

### Usage

```bash
fleet secrets set <app> <KEY>                            # interactive (recommended)
printf '%s' "$NEW_VALUE" | fleet secrets set <app> <KEY> --from-stdin
```

### Flags

| Flag | Description |
|------|-------------|
| `--from-stdin` | Read the value from stdin (terminating newline stripped). |
| `--allow-weak` | Skip the entropy / placeholder check (rejects of `changeme`, `password`, etc.). |

### Why no `<VALUE>` positional?

The legacy `fleet secrets set <app> <KEY> <VALUE>` form is **rejected** since fleet v1.6: argv leaks the value via `/proc/<pid>/cmdline`, ps, shell history, atop accounting, and similar. Use the interactive prompt or `--from-stdin`.

---

## fleet secrets ages

Show every managed secret with its age, provider classification, rotation frequency, sensitivity, and freshness status. Read-only.

### Usage

```bash
fleet secrets ages [<app>] [--json] [--stale-only] [--motd]
```

### Status legend

- `fresh` — under 80% of the provider's `rotationFrequencyDays`
- `aging` — between 80% and 100% of the frequency
- `STALE` — at or past the frequency, time to rotate
- `unknown` — secret name didn't match any known provider

### Examples

```bash
$ fleet secrets ages --stale-only
Secret ages (4 secrets)
  APP      SECRET                AGE       ROTATE EVERY  PROVIDER             SENS      STATUS
  macpool  STRIPE_SECRET_KEY     200 days  90d           Stripe Secret Key    critical  STALE
  ...

$ fleet secrets ages --motd
-- Fleet Secrets ----------------------------------------
  4 secrets need rotation (1 critical, 3 high) across 2 apps
  !! macpool: STRIPE_SECRET_KEY (200d old)
  ...
```

---

## fleet secrets motd-init

Install `/etc/update-motd.d/99-fleet-secrets` so the next shell login summarises stale-secret status alongside fleet deps.

### Usage

```bash
sudo fleet secrets motd-init
```

---

## fleet secrets rotate

Interactive walkthrough that rotates one or every secret in an app. **Safety rails are mandatory** — pre-rotation snapshot, hidden input, format validation, entropy check, masked confirmation, atomic restore on failure, post-rotation health gate.

### Usage

```bash
fleet secrets rotate <app>                                # walk every secret
fleet secrets rotate <app> <KEY>                          # one specific secret
fleet secrets rotate <app> <KEY> --dry-run                # show what would happen
fleet secrets rotate <app> <KEY> --no-restart             # skip auto-restart
fleet secrets rotate <app> ENCRYPTION_KEY --data-migrated # at-rest-key strategy
```

### Rotation strategies

The provider registry classifies each secret name and picks one of:

| Strategy | Examples | Behaviour |
|----------|----------|-----------|
| `immediate` | `STRIPE_SECRET_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `BOOKWHEN_API_TOKEN` | Drop-in replace. Old dies. Safe for upstream API keys. |
| `dual-mode` | `JWT_SECRET`, `NEXTAUTH_SECRET`, `AUTH_SECRET`, `SESSION_SECRET`, `CSRF_SECRET` | New value becomes primary; **old saved as `<NAME>_PREVIOUS`**. App must read both for verification so existing user sessions stay valid through the grace period. |
| `at-rest-key` | `ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY` | **Refused** unless `--data-migrated` is passed. Rotating without re-encrypting stored data first will brick reads. |
| `user-issued` | `USER_API_TOKEN`, `CUSTOMER_API_KEYS` | **Refused entirely**. Rotate per-user inside your app. |

### Audit + rollback

Every rotation creates a snapshot at `vault/.snapshots/<app>-<ts>.env.age` before any change. If reseal fails, the snapshot is automatically restored. Audit log entry is appended to `~/.local/share/fleet/audit.jsonl` (mode `0600`, **never logs the value**).

To restore manually:

```bash
fleet secrets snapshots <app>          # list snapshots, newest first
fleet secrets rollback <app>           # restore the newest
fleet secrets rollback <app> --to <TIMESTAMP>
```

The rollback itself takes a pre-rollback safety snapshot — the rollback is reversible.

---

## fleet secrets rotate-key

Legacy command that rotates the AGE master key (re-encrypts every vault file with a fresh key). **Different concept from `fleet secrets rotate`** — that one rotates application secret values; this one rotates the encryption key the vault uses.

### Usage

```bash
fleet secrets rotate-key [-y]
```
