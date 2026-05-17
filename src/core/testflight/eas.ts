import { spawnSync } from 'node:child_process';

import { execSafe } from '../exec';
import type { EasEnv } from './types';

// the eas cli is invoked through npx so a global install isn't required.
function npxArgs(rest: string[]): string[] {
  return ['--yes', 'eas-cli', ...rest];
}

// version string of the eas cli, or null when it can't be resolved.
export function easVersion(): string | null {
  const res = execSafe('npx', npxArgs(['--version']), { timeout: 120_000 });
  if (!res.ok || !res.stdout) return null;
  return res.stdout.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? null;
}

// run an eas cli subcommand in the mobile project with stdio inherited so a
// long-running build/submit streams its progress live. returns the exit code.
function easLive(projectPath: string, env: EasEnv, rest: string[]): number {
  const result = spawnSync('npx', npxArgs(rest), {
    cwd: projectPath,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
  return result.status ?? 1;
}

// build the ios app for the given eas profile.
export function easBuild(projectPath: string, profile: string, env: EasEnv): number {
  return easLive(projectPath, env, [
    'build', '--platform', 'ios', '--profile', profile, '--non-interactive',
  ]);
}

// submit the latest ios build to testflight. when no app store connect record
// exists for the bundle id yet, eas submit creates one — this is the "new
// entry" path.
export function easSubmit(projectPath: string, profile: string, env: EasEnv): number {
  return easLive(projectPath, env, [
    'submit', '--platform', 'ios', '--profile', profile, '--non-interactive',
  ]);
}
