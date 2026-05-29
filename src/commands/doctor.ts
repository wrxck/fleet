import { existsSync } from 'node:fs';

import { z } from 'zod';

import { execSafe } from '../core/exec';
import { isInitialized, isSealed } from '../core/secrets';
import { load as loadRegistry } from '../core/registry';
import { loadOperator } from '../core/operator';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorData {
  checks: DoctorCheck[];
  summary: { ok: number; warn: number; fail: number };
}

interface SystemRunner {
  exec: (cmd: string, args: string[]) => { ok: boolean; stdout: string; stderr: string };
  exists: (path: string) => boolean;
  loadRegistry: () => ReturnType<typeof loadRegistry>;
  loadOperator: () => ReturnType<typeof loadOperator>;
  vaultInitialised: () => boolean;
  vaultSealed: () => boolean;
}

/** real implementations of every external probe — split out so the test suite
 *  can swap them with deterministic stubs. */
function realRunner(): SystemRunner {
  return {
    exec: (cmd, args) => {
      const r = execSafe(cmd, args, { timeout: 5_000 });
      return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
    },
    exists: existsSync,
    loadRegistry,
    loadOperator,
    vaultInitialised: isInitialized,
    vaultSealed: isSealed,
  };
}

// minimum supported component versions. systemd 240 introduced
// LoadCredentialEncrypted (used by the v2 secrets agent). docker compose v2
// is the minimum the rest of fleet assumes. node 20 is the baseline.
const MIN_NODE_MAJOR = 20;
const MIN_DOCKER_COMPOSE_MAJOR = 2;
const MIN_SYSTEMD = 240;

function checkNode(runner: SystemRunner): DoctorCheck {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return { name: 'node', status: 'fail', detail: `node ${process.versions.node} < ${MIN_NODE_MAJOR}` };
  }
  // suppress the warning about unused runner parameter in this branch
  void runner;
  return { name: 'node', status: 'ok', detail: process.versions.node };
}

function checkAge(runner: SystemRunner): DoctorCheck {
  if (!runner.exec('which', ['age']).ok) {
    return { name: 'age', status: 'fail', detail: 'age not on PATH (apt install age)' };
  }
  const v = runner.exec('age', ['--version']);
  return { name: 'age', status: 'ok', detail: v.stdout || 'present' };
}

function checkDockerCompose(runner: SystemRunner): DoctorCheck {
  const r = runner.exec('docker', ['compose', 'version']);
  if (!r.ok) {
    return { name: 'docker compose', status: 'fail', detail: 'docker compose v2 not available' };
  }
  // sample stdout: "docker compose version v2.27.0"
  const m = r.stdout.match(/v?(\d+)\.(\d+)/);
  if (!m) {
    return { name: 'docker compose', status: 'warn', detail: `unable to parse version: ${r.stdout}` };
  }
  const major = parseInt(m[1], 10);
  if (major < MIN_DOCKER_COMPOSE_MAJOR) {
    return { name: 'docker compose', status: 'fail', detail: `${r.stdout} < v${MIN_DOCKER_COMPOSE_MAJOR}` };
  }
  return { name: 'docker compose', status: 'ok', detail: r.stdout };
}

function checkSystemd(runner: SystemRunner): DoctorCheck {
  const r = runner.exec('systemctl', ['--version']);
  if (!r.ok) {
    return { name: 'systemd', status: 'fail', detail: 'systemctl not available' };
  }
  const m = r.stdout.match(/systemd (\d+)/);
  if (!m) {
    return { name: 'systemd', status: 'warn', detail: `unable to parse version: ${r.stdout.split('\n')[0]}` };
  }
  const v = parseInt(m[1], 10);
  if (v < MIN_SYSTEMD) {
    return {
      name: 'systemd',
      status: 'warn',
      detail: `systemd ${v} < ${MIN_SYSTEMD} (LoadCredentialEncrypted needs 240+; v2 secrets won't work)`,
    };
  }
  return { name: 'systemd', status: 'ok', detail: `systemd ${v}` };
}

function checkRegistry(runner: SystemRunner): DoctorCheck {
  try {
    const reg = runner.loadRegistry();
    return {
      name: 'registry',
      status: 'ok',
      detail: `${reg.apps.length} app(s) registered`,
    };
  } catch (err) {
    return {
      name: 'registry',
      status: 'fail',
      detail: `parse failed: ${(err as Error).message}`,
    };
  }
}

function checkOperator(runner: SystemRunner): DoctorCheck {
  try {
    const op = runner.loadOperator();
    return {
      name: 'operator config',
      status: 'ok',
      detail: `${op.username} @ ${op.domain} (github: ${op.githubOrg})`,
    };
  } catch (err) {
    return {
      name: 'operator config',
      status: 'fail',
      detail: (err as Error).message,
    };
  }
}

function checkVault(runner: SystemRunner): DoctorCheck {
  if (!runner.vaultInitialised()) {
    return { name: 'secrets vault', status: 'warn', detail: 'vault not initialised (run: fleet secrets init)' };
  }
  const sealed = runner.vaultSealed();
  return {
    name: 'secrets vault',
    status: 'ok',
    detail: sealed ? 'initialised, sealed' : 'initialised, unsealed',
  };
}

function checkOrphans(runner: SystemRunner): DoctorCheck {
  try {
    const reg = runner.loadRegistry();
    const orphans = reg.apps.filter(a => !runner.exists(a.composePath));
    if (orphans.length === 0) {
      return { name: 'registered apps on disk', status: 'ok', detail: 'all composePath entries exist' };
    }
    return {
      name: 'registered apps on disk',
      status: 'warn',
      detail: `${orphans.length} orphan(s): ${orphans.map(a => a.name).join(', ')}`,
    };
  } catch {
    // registry parse already reported separately — don't double-fail.
    return { name: 'registered apps on disk', status: 'warn', detail: 'skipped (registry unreadable)' };
  }
}

/** core check runner. exported so tests can drive the pure list. */
export function runChecks(runner: SystemRunner): DoctorData {
  const checks: DoctorCheck[] = [
    checkNode(runner),
    checkAge(runner),
    checkDockerCompose(runner),
    checkSystemd(runner),
    checkRegistry(runner),
    checkOperator(runner),
    checkVault(runner),
    checkOrphans(runner),
  ];
  const summary = {
    ok: checks.filter(c => c.status === 'ok').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
  };
  return { checks, summary };
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'OK',
  warn: 'WARN',
  fail: 'FAIL',
};

export const doctorCommand = defineCommand({
  name: 'doctor',
  summary: 'Preflight: host requirements, registry, vault, operator config, orphan apps',
  args: z.object({}),
  async run(_args, _ctx): Promise<CommandResult<DoctorData>> {
    const data = runChecks(realRunner());
    return {
      ok: data.summary.fail === 0,
      summary: data.summary.fail === 0
        ? `doctor: ${data.summary.ok} ok, ${data.summary.warn} warn, 0 fail`
        : `doctor: ${data.summary.fail} fail, ${data.summary.warn} warn, ${data.summary.ok} ok`,
      data,
      render: {
        kind: 'table',
        columns: ['CHECK', 'STATUS', 'DETAIL'],
        rows: data.checks.map(c => [c.name, STATUS_LABEL[c.status], c.detail]),
      },
    };
  },
});
