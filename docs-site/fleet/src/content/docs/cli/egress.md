---
title: Egress
description: Snapshot and audit outbound traffic per app
---

`fleet egress` observes what each app's containers are talking to. **v1 is observe-only** — it never blocks packets, so there is zero risk of breaking apps. A future phase adds an explicit `enforce` mode (default-deny via nftables) gated behind a manual operator promotion after a clean shadow window.

The snapshot uses `nsenter` to run `ss -tnH` inside each container's network namespace, so it sees real container egress (not just host-side NAT'd flows). Remote IPs are reverse-resolved to hostnames best-effort. RFC1918 (private) destinations don't count as violations.

:::caution[Trust]
Hostname-based allow entries depend on PTR records, which an adversary who controls the reverse DNS for an IP can spoof. **For adversarial auditing, prefer IP-based allow entries** (`8.8.8.8` or `8.8.8.8:443`).
:::

---

## fleet egress observe

Take a snapshot of current outbound flows for one app. Lists each unique destination and flags those not on the allowlist.

### Usage

```bash
fleet egress observe <app> [--json]
```

### Example

```
Egress snapshot: macpool
  Taken: 2026-04-25T16:13:36Z
  Distinct remote endpoints: 3
  CONTAINER  REMOTE                STATUS
  macpool    api.stripe.com:443    allowed
  macpool    api.bookwhen.com:443  allowed
  macpool    sentry.io:443         not in allowlist
```

---

## fleet egress show

Print the configured allowlist + observation mode for one app.

### Usage

```bash
fleet egress show <app>
```

---

## fleet egress allow

Add a host (or `host:port`, `*.host`, `*.host:port`, IP, IP:port) to the app's allowlist.

### Usage

```bash
fleet egress allow <app> <pattern>
```

### Allowlist forms

| Pattern | Matches |
|---------|---------|
| `api.stripe.com` | exact host, any port |
| `api.stripe.com:443` | exact host, exact port |
| `api.stripe.com:*` | exact host, glob port |
| `*.stripe.com` | any subdomain (or apex) of stripe.com, any port |
| `*.stripe.com:443` | any subdomain (or apex) of stripe.com, exact port |
| `8.8.8.8` | exact IP, any port (PTR-spoof-proof) |
| `8.8.8.8:443` | exact IP, exact port (PTR-spoof-proof) |

---

## Schema

Per-app config in `data/registry.json`:

```json
{
  "egress": {
    "mode": "observe",
    "allow": ["api.stripe.com:443", "smtp.gmail.com:587", "*.cloudflare.com"]
  }
}
```

---

## MCP tool

`fleet_egress_snapshot(app)` returns `{ takenAt, uniqueRemotes, violations, flowCount }` — token-conservative summary suitable for an AI agent's first pass. Full per-flow detail is available via the CLI.
