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
