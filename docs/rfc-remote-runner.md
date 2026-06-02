# RFC: remote build runners (`remote` adapter + XcodeBuildMCP bridge)

Status: draft · Author: Matt (with Claude) · 2026-06-02
Target: a follow-up Fleet release

## 1. Problem

Some build/test work can only run on hardware Fleet itself isn't running on —
most sharply **iOS/macOS builds, which require a Mac + Xcode**. Today Fleet
handles this in exactly one way:

> "an ios .ipa can only be built on macos, so `fleet testflight publish` does
> not build locally — it dispatches the repo's testflight workflow, which runs
> on a github-hosted macos runner."
> — `src/core/testflight/workflow.ts`

That GitHub-hosted-runner path is great for *shipping* (no Mac to own, no
Xcode to install) but is the wrong tool for **cheap, interactive iteration**:
every loop is a push + queue + cold macOS VM. For a developer with a Mac on
the desk (or a Mac mini on the LAN), we want Fleet to drive **that** machine as
a first-class, secured build runner — without turning Fleet into an
arbitrary-remote-shell.

This RFC proposes a `remote` runner adapter and a thin host registry, plus an
optional bridge that lets Fleet *drive an existing MCP server* (e.g.
XcodeBuildMCP) running on the remote host instead of reinventing build tools.

## 2. Goals / non-goals

**Goals**
- Register a remote host (e.g. a Mac mini) as a Fleet build runner.
- Run scoped build/test steps on it and stream output through the existing
  `RunEvent` pipeline.
- Reuse mature tooling where it exists (XcodeBuildMCP) rather than rebuild it.
- Least-privilege: allow-listed operations, secrets in the vault, not `ssh
  host -- <anything>`.
- Sit alongside `fleet_testflight_*` so **cloud runner (ship)** and **local
  runner (iterate)** are one coherent surface.

**Non-goals**
- Becoming a general SSH MCP server (those exist; see §7). The value here is
  *scoped, build-shaped* remote execution integrated with routines/secrets.
- Multi-tenant / fleet-of-runners scheduling. Start with one host per kind.
- Replacing the GitHub-hosted-runner path — this complements it.

## 3. Why Fleet is already ~80% of the way there

Reading the current code, the abstractions needed already exist:

- **Runner adapter pattern.** `RunnerAdapter` in `src/adapters/types.ts`
  (`supports(task)` + `run(task, ctx, signal): AsyncIterable<RunEvent>`), with
  `createShellRunner()` (`src/adapters/runner/shell.ts`) spawning local
  processes. A `remote` runner is the same interface over an SSH transport.
- **Fleet is already an MCP _client_.** `createMcpCallRunner()`
  (`src/adapters/runner/mcp-call.ts`) uses `@modelcontextprotocol/sdk`'s
  `Client` + `StdioClientTransport`. Point that transport at a remote MCP
  server and Fleet drives it — see §5.2.
- **Task kinds are a closed enum.** `RoutineTask.kind` ∈ {`claude-cli`,
  `shell`, `mcp-call`} (`src/core/routines/schema.ts`). We add `remote`.
- **Secrets + MCP tiers exist.** `vault/` for age-encrypted connection
  material; `src/mcp/tiers.ts` to gate the new tools by capability tier.

## 4. Transport

How Fleet (on the Linux host) reaches the Mac. Two options, pick per
deployment:

1. **Reverse SSH tunnel** (validated today — see Appendix). The Mac runs
   `ssh -R <port>:localhost:22 fleet-host`; Fleet connects to
   `localhost:<port>`. Zero install on the Linux side, but ephemeral (dies with
   the terminal). Fine for a session; wrap in `autossh` for persistence.
2. **Tailscale** (recommended for a shipped feature). Both nodes on a tailnet;
   Fleet uses `tailscale ssh` or plain SSH to the stable `100.x` address.
   Survives reboots, NAT-friendly, ACL-scoped. Needs the tailscale client on
   the Fleet host (root install).

Either way the runner shells out as: `ssh <host> -- zsh -lc '<step>'`. **The
login shell (`-lc`) is mandatory** — under a non-login shell on macOS, brew's
`node`/`pod` are not on `PATH` (verified; see Appendix).

## 5. Design

### 5.1 `remote` runner adapter

`src/adapters/runner/remote.ts`, implementing `RunnerAdapter` with
`id: 'remote'`. A `remote` task carries `{ host, op, args }` where `op` is an
**allow-listed verb**, not a raw command:

```ts
// lowercase comments to match house style.
type RemoteOp =
  | { op: 'sync'; src: string }                 // rsync working tree -> host workdir
  | { op: 'exec'; tool: 'npm' | 'pod' | 'git' | 'gradle'; args: string[] }
  | { op: 'artifact'; path: string };           // pull a build artifact back

// resolved to: ssh <conn> -- zsh -lc "<rendered allow-listed command>"
// streamed into RunEvent {start, stdout, stderr, end} exactly like shell.ts.
```

Host connection (address, port, key ref, workdir, allowed ops) lives in the
vault, keyed by a host id. The adapter never interpolates a free-form string
into the remote shell.

### 5.2 XcodeBuildMCP bridge (the high-leverage option)

Rather than hand-roll build/sim/device tools, run
[XcodeBuildMCP](https://github.com/getsentry/XcodeBuildMCP) **on the Mac** and
drive it through the *existing* `mcp-call` runner — its `StdioClientTransport`
just needs its stdio bridged over SSH:

```ts
createMcpCallRunner({
  command: 'ssh',
  args: ['mac-runner', '--', 'zsh', '-lc', 'npx -y xcodebuildmcp@latest'],
});
```

Fleet then gets XcodeBuildMCP's ~79 build/simulator/device tools for free, with
Fleet handling auth, secrets, routine orchestration and logging. This is the
recommended path for the iOS surface; the bare `remote` adapter (§5.1) covers
everything else (web builds, Android/gradle, arbitrary toolchains).

### 5.3 MCP tool surface

New tools under the appropriate tier in `src/mcp/`:

- `fleet_runner_register` — add/update a host (transport, key ref, workdir,
  allow-list). Writes to vault.
- `fleet_runner_status` — reachability + toolchain doctor (mirrors
  `fleet_testflight_doctor`): ssh ok? Xcode? node? disk headroom?
- `fleet_runner_exec` — run an allow-listed op, stream output.
- `fleet_ios_build` / `fleet_sim_run` — thin wrappers over the XcodeBuildMCP
  bridge.

## 6. Security model

- **No arbitrary exec.** Ops are allow-listed verbs; raw strings never reach
  the remote shell.
- **Secrets in vault**, not flags. Connection key + host config age-encrypted.
- **Scoped key.** A dedicated runner keypair (as generated for the spike),
  ideally restricted in the host's `authorized_keys` (`command=`/`from=`), or
  fronted by Tailscale ACLs.
- **Tier-gated.** Registration/exec live behind a higher MCP tier than
  read-only status.
- **Doctor before run.** `fleet_runner_status` surfaces disk/Xcode gaps up
  front (the Mac-mini case below would have failed an iOS build at 96% disk —
  better to say so than to start).

## 7. Alternatives considered

- **Off-the-shelf SSH MCP servers** ([classfang/ssh-mcp-server](https://github.com/classfang/ssh-mcp-server),
  [tufantunc/ssh-mcp](https://github.com/tufantunc/ssh-mcp),
  [mixelpixx/SSH-MCP](https://github.com/mixelpixx/SSH-MCP)). Powerful but
  arbitrary-exec; no integration with routines/secrets/testflight. Rejected as
  the primary mechanism; fine as a stop-gap.
- **XcodeBuildMCP standalone** (wire it into Claude directly, bypass Fleet).
  Works, but loses Fleet's secrets/orchestration and the single
  ship-vs-iterate surface. We instead *embed* it via §5.2.
- **GitHub-hosted runners only** (status quo). Keep for shipping; insufficient
  for fast local iteration.

## 8. When to use which runner (decision matrix)

| Need | Runner |
|---|---|
| Ship a signed `.ipa` to TestFlight | GitHub-hosted macOS (existing `testflight`) |
| Fast iOS iterate / debug, dev has a Mac with Xcode + disk | `remote` + XcodeBuildMCP |
| Android build (no Xcode needed) | `remote` + gradle |
| Web build / arbitrary toolchain on a beefier box | `remote` + `exec` |
| No Mac available at all | GitHub-hosted macOS |

## 9. Rollout

1. `remote` adapter + `RoutineTask` kind + vault host registry + `exec`/`sync`.
2. `fleet_runner_status` doctor.
3. XcodeBuildMCP bridge via `mcp-call`; `fleet_ios_build`/`fleet_sim_run`.
4. Tailscale transport + persistent connection; ACL hardening.

## 10. Open questions

- Tailscale vs autossh as the shipped default transport?
- One host per `kind`, or a small pool with capability tags?
- Artifact storage — stream back through Fleet, or push to R2/registry from the
  runner?

## Appendix — what was empirically validated (2026-06-02)

Against Matt's Mac mini over a reverse SSH tunnel from the Fleet Linux host:

- **Connectivity proven.** Fleet host → `ssh -p 2222 -i id_mac_runner
  matt@localhost` (reverse tunnel `-R 2222:localhost:22` from the Mac) reaches
  the Mac and runs commands. This is the §4 option-1 transport, working.
- **Host:** Apple Silicon (arm64), macOS 26.0. 8 GB RAM.
- **Toolchain present (login shell):** node 25.8.2, npm 11.11.1, git, **pod
  1.16.2**, JDK 25. `gh` and full **Xcode are NOT installed** (only Command
  Line Tools).
- **PATH gotcha:** node/pod resolve only under `zsh -lc` (login shell), not a
  bare non-login shell. The adapter must use `-lc` (§4).
- **Disk wall:** `/System/Volumes/Data` is **181 GiB used / 8.5 GiB free
  (96%)**. Full Xcode (~40 GB) cannot be installed without freeing ~35 GB —
  so **local iOS builds on this host are blocked today**; use the
  GitHub-hosted path for iOS until disk is cleared. Android (no Xcode) and web
  builds are feasible disk permitting.

This appendix is the concrete motivation for `fleet_runner_status` doing a
disk/Xcode preflight (§6).
