# Setting a secret

There are two ways to write a value into the vault. Pick by whether a human with
a terminal is involved.

## If you are an agent, script, or anything without a terminal

Use the **MCP tool**, not the CLI:

```
fleet_secrets_set   { app, key, value }
fleet_secrets_unseal
```

then **deploy** the app (a restart is not enough — the value is injected at
deploy time).

`fleet_secrets_set` is in the `mutate` tier, so it is allowed by default; it
does not need root, a TTY, or the human to do anything. An agent asking a human
to run a shell command to set a secret is nearly always the wrong call — the
tool exists precisely so that hand-off is unnecessary.

## If you are a human at a terminal

```bash
sudo fleet secrets set <app> <KEY>
```

The value is read from a hidden prompt. It is never taken from the command line.

## If a command must run without a terminal

The prompt has nothing to read from, so pass the value on stdin and say so:

```bash
sudo fleet secrets set <app> <KEY> --from-stdin < /path/to/value.txt
```

Reading from a file is preferred over a pipeline. A value written inline —
`printf '%s' 'the-value' | ...` — is visible in `/proc/<pid>/cmdline` while the
command runs and is written to shell history afterwards.

## Why the value is never an argument

Passing a secret in argv was the cause of a previous incident: process
arguments are world-readable on the host and persist in history files. The CLI
rejects that form outright rather than accepting it with a warning.

## Common failure

```
Cancelled (stdin closed)
```

means the command ran without a terminal and without `--from-stdin`. It is not
a permissions problem and not a vault problem. Use one of the two forms above.
Since fleet 1.15.2 the CLI detects this case and prints the correct commands
instead of failing with that bare message.

## After setting a value

1. `fleet secrets unseal` — writes the vault to `/run/fleet-secrets/`
2. `fleet deploy <app>` — a running container keeps its old environment until
   it is redeployed

Check `fleet secrets drift` first if you suspect someone changed a runtime value
without sealing it back; unsealing overwrites unsealed runtime changes.
