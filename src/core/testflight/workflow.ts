import { execSafe, execLive } from '../exec';

// an ios .ipa can only be built on macos, so `fleet testflight publish`
// does not build locally — it dispatches the repo's testflight workflow,
// which runs on a github-hosted macos runner. every operation here is the
// github cli driving that workflow.

// version line of the github cli, or null when it isn't installed.
export function ghVersion(): string | null {
  const res = execSafe('gh', ['--version'], { timeout: 30_000 });
  if (!res.ok || !res.stdout) return null;
  return res.stdout.split('\n').map(l => l.trim()).filter(Boolean)[0] ?? null;
}

// owner/name of the github repo backing a project directory, or null when
// the directory is not a github checkout the gh cli recognises.
export function resolveRepo(projectPath: string): string | null {
  const res = execSafe(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
    { cwd: projectPath, timeout: 30_000 },
  );
  if (!res.ok) return null;
  return res.stdout.trim() || null;
}

// names of the actions secrets configured on a repo, or null when they
// cannot be listed (gh not authenticated, or no access to the repo).
export function repoSecrets(repo: string): string[] | null {
  const res = execSafe('gh', ['secret', 'list', '--repo', repo], { timeout: 30_000 });
  if (!res.ok) return null;
  return res.stdout
    .split('\n')
    .map(l => l.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export interface WorkflowDispatch {
  ok: boolean;
  message: string;
}

// dispatch the testflight build workflow. `gh workflow run` queues a
// workflow_dispatch event and returns no run id, so the caller resolves the
// resulting run separately via latestRun.
export function dispatchWorkflow(
  repo: string,
  workflow: string,
  ref?: string,
): WorkflowDispatch {
  const args = ['workflow', 'run', workflow, '--repo', repo];
  if (ref) args.push('--ref', ref);
  const res = execSafe('gh', args, { timeout: 60_000 });
  return {
    ok: res.ok,
    message: (res.ok ? res.stdout : res.stderr).trim() || (res.ok ? 'dispatched' : 'dispatch failed'),
  };
}

export interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
}

// the most recent run of a workflow, or null when it has never run.
export function latestRun(repo: string, workflow: string): WorkflowRun | null {
  const res = execSafe(
    'gh',
    [
      'run', 'list', '--repo', repo, '--workflow', workflow,
      '--limit', '1', '--json', 'databaseId,status,conclusion,url,createdAt',
    ],
    { timeout: 30_000 },
  );
  if (!res.ok || !res.stdout) return null;
  try {
    const runs = JSON.parse(res.stdout) as WorkflowRun[];
    return runs[0] ?? null;
  } catch {
    return null;
  }
}

// stream a workflow run to completion, inheriting stdio so progress shows
// live. returns the exit code — non-zero when the run failed.
export function watchRun(repo: string, runId: number): number {
  return execLive('gh', ['run', 'watch', String(runId), '--repo', repo, '--exit-status']);
}
