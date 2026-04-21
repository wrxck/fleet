import { spawnSync } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

export function execSafe(
  cmd: string,
  args: string[],
  opts: { timeout?: number; cwd?: string; env?: Record<string, string>; input?: string } = {},
): ExecResult {
  const result = spawnSync(cmd, args, {
    timeout: opts.timeout ?? 30_000,
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    encoding: 'utf-8',
    stdio: 'pipe',
    input: opts.input,
  });
  if (result.error) {
    return {
      stdout: '',
      stderr: result.error.message,
      exitCode: 1,
      ok: false,
    };
  }
  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    exitCode: result.status ?? 1,
    ok: result.status === 0,
  };
}

export function execGit(
  args: string[],
  opts: { cwd: string; timeout?: number; env?: Record<string, string> },
): ExecResult {
  // Prepend -c safe.directory=<cwd> so git under root can operate on repos owned by other users.
  // This is scoped to the one command — does not mutate global git config.
  return execSafe('git', ['-c', `safe.directory=${opts.cwd}`, ...args], opts);
}

export function execLive(cmd: string, args: string[], opts: { cwd?: string } = {}): number {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
  return result.status ?? 1;
}
