import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { addAgentDependency } from '../templates/app-unit-edit.js';
import { generateAgentUnit } from '../templates/agent-unit.js';
import { migrateComposeToV2 } from '../templates/compose-edit.js';
import { credentialPathFor, encryptCredential, removeCredential } from './secrets-v2-creds.js';
import { generateKeypair, reencryptForRecipient } from './secrets-v2-keypair.js';
import { listSnapshots, restoreSnapshot, snapshotApp } from './secrets-v2-snapshot.js';
import type { Snapshot, SnapshotInput } from './secrets-v2-snapshot.js';
import { loadManifest, saveManifest, VAULT_DIR } from './secrets.js';
import { findApp, load } from './registry.js';
import type { AppEntry } from './registry.js';
import { execSafe } from './exec.js';
import { SecretsError } from './errors.js';
import { validateApp } from './secrets-validate.js';

export interface MigrateOpts {
  app: string;
  noRestartApp?: boolean;
  dryRun?: boolean;
}

export interface MigrateStep {
  step: number;
  name: string;
  ok: boolean;
  detail?: string;
}

export interface MigrateResult {
  app: string;
  snapshotDir: string | null;
  steps: MigrateStep[];
  rolledBack: boolean;
}

const AGENT_UNIT_PATH = '/etc/systemd/system/fleet-secrets-agent@.service';

const STEP_NAMES: Record<number, string> = {
  1: 'snapshot app state',
  2: 'generate per-app age keypair',
  3: 're-encrypt vault blob for new recipient',
  4: 'install fleet-secrets-agent@ systemd unit template',
  5: 'migrate compose file to v2 socket mode',
  6: 'add agent dependency to app systemd unit',
  7: 'update manifest: mode=socket, recipient=<pub>',
  8: 'encrypt private key as systemd credential',
  9: 'enable and verify fleet-secrets-agent@<app>.service',
  10: 'restart app container (docker compose up -d --force-recreate)',
  11: 'health check app via HTTP /health',
};

async function pollHealth(url: string, deadlineMs: number = 30_000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (execSafe('curl', ['-sf', '--max-time', '5', url]).ok) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function waitForSocket(socketPath: string, timeoutMs: number = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

function doRollback(opts: {
  snapInput: SnapshotInput;
  snap: Snapshot;
  app: string;
  credentialWritten: boolean;
  agentEnabled: boolean;
  noRestartApp: boolean;
  failedStep: number;
  composePath: string;
}): void {
  try { restoreSnapshot(opts.snapInput, opts.snap); } catch { /* best-effort */ }
  const bakPath = join(VAULT_DIR, `${opts.app}.env.age.v1.bak`);
  if (existsSync(bakPath)) {
    try { unlinkSync(bakPath); } catch { /* best-effort */ }
  }
  if (opts.credentialWritten) {
    try { removeCredential(opts.app); } catch { /* best-effort */ }
  }
  if (opts.agentEnabled) {
    try {
      execSafe('systemctl', ['disable', '--now', `fleet-secrets-agent@${opts.app}.service`]);
    } catch { /* best-effort */ }
  }
  try { execSafe('systemctl', ['daemon-reload']); } catch { /* best-effort */ }
  if (!opts.noRestartApp && opts.failedStep >= 10) {
    try {
      execSafe('docker', ['compose', 'up', '-d', '--force-recreate'], { cwd: opts.composePath });
    } catch { /* best-effort */ }
  }
}

export async function migrateAppToV2(opts: MigrateOpts): Promise<MigrateResult> {
  const { app, noRestartApp = false, dryRun = false } = opts;

  const registry = load();
  const appEntry = findApp(registry, app);
  if (!appEntry) {
    throw new SecretsError(`app '${app}' not found in fleet registry`);
  }

  const manifest = loadManifest();
  if (manifest.apps[app]?.mode === 'socket') {
    return {
      app,
      snapshotDir: null,
      steps: [{ step: 1, name: 'already migrated to v2', ok: true }],
      rolledBack: false,
    };
  }

  if (dryRun) {
    return {
      app,
      snapshotDir: null,
      steps: Object.entries(STEP_NAMES).map(([n, name]) => ({ step: Number(n), name, ok: true })),
      rolledBack: false,
    };
  }

  const snapInput: SnapshotInput = {
    app,
    backupRoot: join(VAULT_DIR, 'backups'),
    vaultDir: VAULT_DIR,
    encryptedFile: `${app}.env.age`,
    composeDir: appEntry.composePath,
    composeFile: appEntry.composeFile ?? 'docker-compose.yml',
    appUnitFile: `/etc/systemd/system/${app}.service`,
  };

  const steps: MigrateStep[] = [];
  const push = (step: number, ok: boolean, detail?: string) =>
    steps.push({ step, name: STEP_NAMES[step] ?? `step ${step}`, ok, detail });

  let snap: Snapshot | null = null;
  let credentialWritten = false;
  let agentEnabled = false;

  const rb = (failedStep: number, err: unknown) => {
    push(failedStep, false, err instanceof Error ? err.message : String(err));
    if (snap) {
      doRollback({
        snapInput, snap, app, credentialWritten, agentEnabled,
        noRestartApp, failedStep, composePath: appEntry.composePath,
      });
    }
  };

  // step 1
  try {
    snap = snapshotApp(snapInput);
    push(1, true, snap.dir);
  } catch (err) {
    push(1, false, err instanceof Error ? err.message : String(err));
    return { app, snapshotDir: null, steps, rolledBack: false };
  }

  // step 2
  let keypair: ReturnType<typeof generateKeypair>;
  try {
    keypair = generateKeypair();
    push(2, true);
  } catch (err) {
    rb(2, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 3
  try {
    const oldCiphertext = readFileSync(join(VAULT_DIR, `${app}.env.age`), 'utf-8');
    const newCiphertext = reencryptForRecipient({
      ciphertext: oldCiphertext,
      oldKeyPath: '/etc/fleet/age.key',
      newRecipient: keypair.publicKey,
    });
    renameSync(join(VAULT_DIR, `${app}.env.age`), join(VAULT_DIR, `${app}.env.age.v1.bak`));
    writeFileSync(join(VAULT_DIR, `${app}.env.age`), newCiphertext);
    push(3, true);
  } catch (err) {
    rb(3, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 4
  try {
    const unitContent = generateAgentUnit();
    const existing = existsSync(AGENT_UNIT_PATH) ? readFileSync(AGENT_UNIT_PATH, 'utf-8') : null;
    if (existing !== unitContent) {
      writeFileSync(AGENT_UNIT_PATH, unitContent, { mode: 0o644 });
    }
    push(4, true);
  } catch (err) {
    rb(4, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 5
  try {
    const composePath = join(appEntry.composePath, appEntry.composeFile ?? 'docker-compose.yml');
    writeFileSync(composePath, migrateComposeToV2(readFileSync(composePath, 'utf-8')));
    push(5, true);
  } catch (err) {
    rb(5, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 6
  try {
    const unitPath = `/etc/systemd/system/${app}.service`;
    writeFileSync(unitPath, addAgentDependency(readFileSync(unitPath, 'utf-8'), app));
    push(6, true);
  } catch (err) {
    rb(6, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 7
  try {
    const mf = loadManifest();
    mf.apps[app] = { ...mf.apps[app], mode: 'socket', recipient: keypair.publicKey };
    saveManifest(mf);
    push(7, true);
  } catch (err) {
    rb(7, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 8
  try {
    encryptCredential({ name: `${app}-age-key`, plaintext: keypair.privateKey, outputPath: credentialPathFor(app) });
    credentialWritten = true;
    push(8, true);
  } catch (err) {
    rb(8, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 9
  try {
    const reload = execSafe('systemctl', ['daemon-reload']);
    if (!reload.ok) throw new SecretsError(`systemctl daemon-reload failed: ${reload.stderr}`);
    const enable = execSafe('systemctl', ['enable', '--now', `fleet-secrets-agent@${app}.service`]);
    if (!enable.ok) throw new SecretsError(`systemctl enable failed: ${enable.stderr}`);
    agentEnabled = true;
    const active = execSafe('systemctl', ['is-active', `fleet-secrets-agent@${app}.service`]);
    if (active.stdout.trim() !== 'active') {
      throw new SecretsError(`agent not active: ${active.stdout.trim()}`);
    }
    if (!await waitForSocket(`/run/fleet-secrets/${app}.sock`)) {
      throw new SecretsError(`agent socket did not appear within 5s: /run/fleet-secrets/${app}.sock`);
    }
    push(9, true);
  } catch (err) {
    rb(9, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
  }

  // step 10
  if (noRestartApp) {
    push(10, true);
  } else {
    try {
      execSafe('docker', ['compose', 'up', '-d', '--force-recreate'], { cwd: appEntry.composePath });
      push(10, true);
    } catch (err) {
      rb(10, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
    }
  }

  // step 11
  if (noRestartApp) {
    push(11, true);
  } else {
    try {
      const port = appEntry.port;
      const url = port ? `http://localhost:${port}/health` : 'http://localhost/health';
      if (!await pollHealth(url)) throw new SecretsError(`health check timed out after 30s for ${url}`);
      push(11, true);
    } catch (err) {
      rb(11, err); return { app, snapshotDir: snap.dir, steps, rolledBack: true };
    }
  }

  return { app, snapshotDir: snap.dir, steps, rolledBack: false };
}

export interface RevertOpts {
  app: string;
  snapshotTimestamp?: string;
}

export interface RevertResult {
  app: string;
  snapshotUsed: string;
  steps: MigrateStep[];
  ok: boolean;
}

const REVERT_STEP_NAMES: Record<number, string> = {
  1: 'disable fleet-secrets-agent@<app>.service (best-effort)',
  2: 'remove systemd credential for app (best-effort)',
  3: 'remove .v1.bak file if present (best-effort)',
  4: 'restore snapshot (vault blob, manifest, compose, unit)',
  5: 'systemctl daemon-reload',
  6: 'restart app container (docker compose up -d --force-recreate)',
  7: 'validate v1 unseal-based secrets',
};

export async function revertAppFromV2(opts: RevertOpts): Promise<RevertResult> {
  const { app, snapshotTimestamp } = opts;

  const registry = load();
  const appEntry = findApp(registry, app);
  if (!appEntry) {
    throw new SecretsError(`app '${app}' not found in fleet registry`);
  }

  const manifest = loadManifest();
  if (manifest.apps[app]?.mode !== 'socket') {
    throw new SecretsError(`app '${app}' is not in v2 (socket) mode — nothing to revert`);
  }

  const snapshots = listSnapshots(join(VAULT_DIR, 'backups'), app);
  if (snapshots.length === 0) {
    throw new SecretsError(`no snapshots found for app '${app}' — cannot revert`);
  }

  let snap: Snapshot;
  if (snapshotTimestamp !== undefined) {
    const found = snapshots.find(s => s.timestamp === snapshotTimestamp);
    if (!found) {
      throw new SecretsError(`no snapshot with timestamp '${snapshotTimestamp}' found for app '${app}'`);
    }
    snap = found;
  } else {
    snap = snapshots[0];
  }

  const snapInput: SnapshotInput = {
    app,
    backupRoot: join(VAULT_DIR, 'backups'),
    vaultDir: VAULT_DIR,
    encryptedFile: `${app}.env.age`,
    composeDir: appEntry.composePath,
    composeFile: appEntry.composeFile ?? 'docker-compose.yml',
    appUnitFile: `/etc/systemd/system/${app}.service`,
  };

  const steps: MigrateStep[] = [];
  const push = (step: number, ok: boolean, detail?: string) =>
    steps.push({ step, name: REVERT_STEP_NAMES[step] ?? `step ${step}`, ok, detail });

  // step 1 — best-effort: disable agent unit
  try {
    execSafe('systemctl', ['disable', '--now', `fleet-secrets-agent@${app}.service`]);
    push(1, true);
  } catch {
    push(1, true, 'agent unit disable skipped (not running or not found)');
  }

  // step 2 — best-effort: remove credential
  try {
    removeCredential(app);
    push(2, true);
  } catch {
    push(2, true, 'credential removal skipped (not present)');
  }

  // step 3 — best-effort: remove v1 backup file
  const bakPath = join(VAULT_DIR, `${app}.env.age.v1.bak`);
  try {
    if (existsSync(bakPath)) {
      unlinkSync(bakPath);
    }
    push(3, true);
  } catch {
    push(3, true, '.v1.bak removal skipped');
  }

  // step 4 — restore snapshot (mandatory)
  try {
    restoreSnapshot(snapInput, snap);
    push(4, true);
  } catch (err) {
    push(4, false, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // step 5 — daemon-reload (mandatory)
  try {
    const reload = execSafe('systemctl', ['daemon-reload']);
    if (!reload.ok) throw new SecretsError(`systemctl daemon-reload failed: ${reload.stderr}`);
    push(5, true);
  } catch (err) {
    push(5, false, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // step 6 — restart app (mandatory)
  try {
    execSafe('docker', ['compose', 'up', '-d', '--force-recreate'], { cwd: appEntry.composePath });
    push(6, true);
  } catch (err) {
    push(6, false, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // step 7 — validate v1 secrets (mandatory)
  try {
    const validation = validateApp(app);
    if (!validation.ok) {
      throw new SecretsError(`v1 secrets validation failed — missing keys: ${validation.missing.join(', ')}`);
    }
    push(7, true);
  } catch (err) {
    push(7, false, err instanceof Error ? err.message : String(err));
    throw err;
  }

  return { app, snapshotUsed: snap.timestamp, steps, ok: true };
}
