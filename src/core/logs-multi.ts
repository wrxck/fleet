/**
 * Multi-source log tailer. Spawns `docker logs -f` per selected container,
 * splits the streams on newlines, applies filters (level / grep / since),
 * emits structured events to a callback. Caller is responsible for rendering.
 *
 * Design notes:
 *  - Each container gets its own subprocess so a stuck/dead container can't
 *    block the others.
 *  - Stdout + stderr are merged. Docker writes app output to stdout for
 *    json-file driver containers; some apps log errors to stderr.
 *  - Lines are emitted in arrival order per source. Cross-source ordering
 *    is best-effort (no global timestamp synchronisation — we don't reorder).
 *  - stop() kills the entire process group cleanly. Idempotent.
 *  - Used by both the CLI (`fleet logs --all -f`) and the TUI logs view.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { createLineRedactor, effectiveRedaction, type RedactionConfig } from './redaction';
import type { AppEntry } from './registry';

export interface LogSource {
  /** Logical app name (used in the prefix). */
  app: string;
  /** Docker container name. */
  container: string;
  /** Per-app redaction config, populated by resolveSources. Sources built by
   *  hand fall back to opts.redaction, then to the module defaults. */
  redaction?: RedactionConfig | null;
}

export interface LogLine {
  /** Wall-clock receipt time (we don't trust the in-line timestamp — sources differ). */
  ts: Date;
  app: string;
  container: string;
  /** Inferred level from substring scan. 'unknown' if nothing matched. */
  level: 'debug' | 'info' | 'warn' | 'error' | 'unknown';
  text: string;
}

export interface MultiTailOpts {
  /** Tail N lines from each source before going live. Default 50. */
  tail?: number;
  /** Restrict to lines newer than this (Docker's --since syntax: '15m', '1h'). */
  since?: string;
  /** Only emit lines at or above this level (everything if 'debug' or omitted). */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** Substring filter applied AFTER level — case sensitive. */
  grep?: string;
  /** When true, follow new entries forever (default). When false, just dump tail and exit. */
  follow?: boolean;
  /** Fallback redaction config for sources that carry none of their own.
   *  Omit for the built-in defaults; pass `{ enabled: false }` to opt out. */
  redaction?: RedactionConfig | null;
}

export interface MultiTailHandle {
  /** Kill all spawned subprocesses. Idempotent. Resolves when teardown is complete. */
  stop: () => Promise<void>;
  /** Number of currently-running tailers (drops as containers die). */
  active: () => number;
}

const LEVEL_RANK: Record<NonNullable<MultiTailOpts['level']>, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

const LEVEL_PATTERNS: Array<{ level: LogLine['level']; re: RegExp }> = [
  { level: 'error', re: /\b(error|err|fatal|critical|exception|panic|trace)\b|\bE\d{4}\b/i },
  { level: 'warn',  re: /\b(warn|warning|deprecated)\b/i },
  { level: 'debug', re: /\b(debug|trace|verbose)\b/i },
  { level: 'info',  re: /\b(info|notice)\b/i },
];

/** Best-effort level inference from a line. Returns 'unknown' if nothing matches. */
export function inferLevel(text: string): LogLine['level'] {
  // First match wins; ordering above puts error before warn etc.
  for (const { level, re } of LEVEL_PATTERNS) if (re.test(text)) return level;
  return 'unknown';
}

/**
 * Glob-match a container name against a pattern. Supports * wildcards.
 * `*-postgres` matches `glitchtip-postgres`, `shared-postgres`, etc.
 */
export function matchesContainerGlob(name: string, glob: string): boolean {
  const re = new RegExp(
    '^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return re.test(name);
}

/**
 * Resolve a selection spec into a flat list of LogSource entries.
 * - Empty selection → all containers across all apps
 * - apps + containers can be combined; intersection wins
 */
export function resolveSources(
  apps: AppEntry[],
  selection: { apps?: string[]; containers?: string[] } = {},
): LogSource[] {
  const allowedAppNames = selection.apps && selection.apps.length > 0
    ? new Set(selection.apps)
    : null;
  const containerGlobs = selection.containers && selection.containers.length > 0
    ? selection.containers
    : null;

  const out: LogSource[] = [];
  for (const app of apps) {
    if (allowedAppNames && !allowedAppNames.has(app.name)) continue;
    for (const container of app.containers) {
      if (containerGlobs && !containerGlobs.some(g => matchesContainerGlob(container, g))) {
        continue;
      }
      // redaction config travels with the source so a multi-app tail applies
      // each app's own settings, including in the TUI which never sees the
      // AppEntry list again after this call.
      out.push({ app: app.name, container, redaction: effectiveRedaction(app) });
    }
  }
  return out;
}

/**
 * Start tailing the given sources. Calls onLine for every emitted line that
 * passes the filter chain. Returns a handle for graceful shutdown.
 *
 * For test injection, pass a custom `spawnFn` that mimics Node's spawn.
 */
export function startMultiTail(
  sources: LogSource[],
  opts: MultiTailOpts,
  onLine: (line: LogLine) => void,
  onClose?: (source: LogSource, code: number | null) => void,
  spawnFn: typeof spawn = spawn,
): MultiTailHandle {
  const procs = new Map<string, ChildProcess>();
  const minLevelRank = opts.level ? LEVEL_RANK[opts.level] : -1;
  const tail = opts.tail ?? 50;
  const follow = opts.follow !== false;

  for (const src of sources) {
    const args = ['logs', '--tail', String(tail)];
    if (follow) args.push('-f');
    if (opts.since) args.push('--since', opts.since);
    args.push(src.container);

    const proc = spawnFn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    procs.set(src.container, proc);

    let stdoutBuf = '';
    let stderrBuf = '';
    // one redactor per stream: it is stateful (it tracks whether we are inside
    // a multi-line PEM block) and stdout/stderr interleave independently.
    const redactOut = createLineRedactor(src.redaction ?? opts.redaction);
    const redactErr = createLineRedactor(src.redaction ?? opts.redaction);

    const flushLine = (text: string, redact: (l: string) => string) => {
      if (!text) return;
      // redact first and unconditionally: the redactor is stateful, so skipping
      // it for filtered-out lines would desync the PEM block tracker and let
      // key material through on the next line that happens to match the filter.
      const redacted = redact(text);
      const level = inferLevel(text);
      if (minLevelRank >= 0 && level !== 'unknown') {
        const rank = LEVEL_RANK[level as 'debug' | 'info' | 'warn' | 'error'];
        if (rank < minLevelRank) return;
      }
      // level and grep match the RAW line, redaction is applied after, so an
      // operator tailing for a hostname still gets their hits. same trade-off
      // as readContainerLogs, documented there.
      if (opts.grep && !text.includes(opts.grep)) return;
      // a line the redactor swallowed entirely (PEM body) is dropped rather
      // than emitted as a blank.
      if (redacted === '') return;
      onLine({ ts: new Date(), app: src.app, container: src.container, level, text: redacted });
    };

    const handleChunk = (which: 'out' | 'err') => (chunk: Buffer) => {
      const buf = which === 'out' ? stdoutBuf : stderrBuf;
      const merged = buf + chunk.toString('utf8');
      const parts = merged.split('\n');
      const remainder = parts.pop() ?? '';
      const redact = which === 'out' ? redactOut : redactErr;
      for (const p of parts) flushLine(p, redact);
      if (which === 'out') stdoutBuf = remainder;
      else stderrBuf = remainder;
    };

    proc.stdout?.on('data', handleChunk('out'));
    proc.stderr?.on('data', handleChunk('err'));
    proc.on('close', code => {
      // Flush any unfinished partial line — common when a container dies between newlines.
      if (stdoutBuf) { flushLine(stdoutBuf, redactOut); stdoutBuf = ''; }
      if (stderrBuf) { flushLine(stderrBuf, redactErr); stderrBuf = ''; }
      procs.delete(src.container);
      onClose?.(src, code);
    });
  }

  let stopped = false;
  return {
    active: () => procs.size,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      for (const proc of procs.values()) {
        try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      }
      // Give them a beat to die gracefully, then escalate.
      await new Promise<void>(resolve => {
        const deadline = Date.now() + 2000;
        const tick = () => {
          if (procs.size === 0 || Date.now() > deadline) {
            for (const proc of procs.values()) {
              try { proc.kill('SIGKILL'); } catch { /* already dead */ }
            }
            resolve();
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });
    },
  };
}
