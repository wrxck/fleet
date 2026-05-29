# command registry parity

the cli has two dispatch surfaces during the registry migration:

1. `dispatchRegistryCommand` in `src/cli.ts` — the new generic dispatcher
   that consumes `CommandDef`s exported from `src/registry/`.
2. the legacy `switch (command)` in `src/cli.ts` — straight calls into
   `src/commands/<name>.ts`.

every command that still lives in the legacy switch needs a duplicate
help-text + flag-parsing path. two surfaces mean two ways to drift.
the migration is finished when the switch is empty and `cli.ts` only
needs the registry dispatcher.

## still in the legacy switch

(post-1.10.0, ordered by likely effort to migrate)

| command       | notes                                            |
| ------------- | ------------------------------------------------ |
| logs          | takes free-form -f and child-process passthrough |
| egress        | subcommand bundle (snapshot, apply, …)           |
| deps          | subcommand bundle, large surface                 |
| audit         | greenlight integration, async chain              |
| testflight    | subcommand bundle (publish, builds, …) — fresh   |
| deploy        | drives the full register + build + start flow    |
| nginx         | subcommand bundle (add, remove, list)            |
| secrets       | the deepest cli surface in the project           |
| git           | subcommand bundle, partially migrated already    |
| watchdog      | one entry point, easy                            |
| guard         | subcommand bundle                                |
| backup        | subcommand bundle (serve, dump, list, …)         |
| routines      | subcommand bundle                                |
| routine-run   | one entry point, easy                            |

`mcp`, `tui`, `dashboard` are intentionally cli-only — they never run
under the mcp bridge.

## migrating one command

see the `feat(<area>): migrate <command> to a registry CommandDef`
commit pattern from #102 / #103 (Apr 2026). every commit should:

- add a `CommandDef` with a typed args schema
- add the command to its area's registry export
- delete the matching case from the `switch` in `src/cli.ts`
- delete any now-unused import of the legacy command handler
- add a registry-bridge test that asserts the command is exposed via mcp
  (or marked `cliOnly` if not)
