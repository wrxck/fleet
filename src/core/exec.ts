import { execSync, spawnSync } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}

export function exec(cmd: string, opts: { timeout?: number; cwd?: string } = {}): ExecResult {
  try {
    const stdout = execSync(cmd, {
      timeout: opts.timeout ?? 30_000,
      cwd: opts.cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0, ok: true };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (e.stdout ?? '').toString().trim(),
      stderr: (e.stderr ?? '').toString().trim(),
      exitCode: e.status ?? 1,
      ok: false,
    };
  }
}

export function execLive(cmd: string, args: string[], opts: { cwd?: string } = {}): number {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    encoding: 'utf-8',
  });
  return result.status ?? 1;
}
