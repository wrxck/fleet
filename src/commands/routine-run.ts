import { load } from '../core/registry.js';
import { createRuntime } from '../tui/routines/runtime.js';
import { error } from '../ui/output.js';

interface ParsedArgs {
  id?: string;
  target?: string;
  trigger?: 'manual' | 'scheduled' | 'api';
  json?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--id':
        out.id = argv[++i];
        break;
      case '--target':
        out.target = argv[++i];
        break;
      case '--trigger': {
        const v = argv[++i];
        if (v === 'manual' || v === 'scheduled' || v === 'api') out.trigger = v;
        break;
      }
      case '--json':
        out.json = true;
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
      default:
        break;
    }
  }
  return out;
}

const HELP = `fleet routine-run - execute a registered routine

Usage: fleet routine-run --id <routine-id> [options]

Options:
  --id <id>             Required. The routine id to run.
  --target <repo>       Optional. Run scoped to a single registered repo.
  --trigger <source>    manual (default) | scheduled | api
  --json                Emit events as JSON lines to stdout
  -h, --help            Show this help

Exit codes:
  0   routine ended with status=ok
  1   routine ended with status=failed or timeout or aborted
  2   invocation error (unknown id, bad args)

Intended entrypoint for systemd-timer-generated units. Persists every
event to sqlite and exits with the run's status.
`;

export async function routineRunCommand(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help || !args.id) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 2);
    return;
  }

  const runtime = createRuntime({ seedDefaults: false });
  const registry = load();

  const repoPath = args.target
    ? registry.apps.find(a => a.name === args.target)?.composePath ?? null
    : null;
  if (args.target && !repoPath) {
    error(`unknown target repo: ${args.target}`);
    runtime.close();
    process.exit(2);
    return;
  }

  const routine = runtime.store.get(args.id);
  if (!routine) {
    error(`routine not found: ${args.id}`);
    runtime.close();
    process.exit(2);
    return;
  }

  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let finalStatus: string | null = null;
  try {
    for await (const ev of runtime.engine.runOnce(
      args.id,
      { repo: args.target ?? null, repoPath },
      args.trigger ?? 'manual',
      ac.signal,
    )) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(ev)}\n`);
        continue;
      }
      switch (ev.kind) {
        case 'start':
          process.stdout.write(`▶ ${args.id}${ev.target ? ` · ${ev.target}` : ''}\n`);
          break;
        case 'stdout':
          process.stdout.write(ev.chunk);
          break;
        case 'stderr':
          process.stderr.write(ev.chunk);
          break;
        case 'tool-call':
          process.stdout.write(`  ↳ ${ev.name}${ev.argsPreview ? ` ${ev.argsPreview}` : ''}\n`);
          break;
        case 'cost':
          process.stdout.write(`  $${ev.usd.toFixed(4)}  in=${ev.inputTokens}  out=${ev.outputTokens}\n`);
          break;
        case 'end':
          finalStatus = ev.status;
          process.stdout.write(`◼ ${ev.status} exit=${ev.exitCode} (${ev.durationMs}ms)${ev.error ? ` — ${ev.error}` : ''}\n`);
          break;
      }
    }
  } catch (err) {
    error(`run failed: ${(err as Error).message}`);
    runtime.close();
    process.exit(1);
    return;
  }

  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  runtime.close();
  process.exit(finalStatus === 'ok' ? 0 : 1);
}
