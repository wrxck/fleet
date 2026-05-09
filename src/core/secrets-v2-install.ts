import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execSafe } from './exec.js';
import { SecretsError } from './errors.js';
import { generateAgentUnit } from '../templates/agent-unit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_SOURCE = join(__dirname, '..', 'bin', 'fleet-agent.js');
const DEFAULT_BINARY_DEST = '/usr/local/bin/fleet-agent';
const DEFAULT_UNIT_PATH = '/etc/systemd/system/fleet-secrets-agent@.service';

export interface InstallResult {
  agentBinaryInstalled: boolean;
  unitFileInstalled: boolean;
  daemonReloaded: boolean;
  templateParseable: boolean;
}

export async function installV2(opts: {
  dryRun?: boolean;
  agentSourcePath?: string;
  destBinaryPath?: string;
  unitFilePath?: string;
} = {}): Promise<InstallResult> {
  const sourcePath = opts.agentSourcePath ?? DEFAULT_AGENT_SOURCE;
  const destPath = opts.destBinaryPath ?? DEFAULT_BINARY_DEST;
  const unitPath = opts.unitFilePath ?? DEFAULT_UNIT_PATH;
  const dryRun = opts.dryRun ?? false;

  if (!existsSync(sourcePath)) {
    throw new SecretsError(
      `agent binary source not found at ${sourcePath} — run 'npm run build' first`,
    );
  }

  const sourceContent = readFileSync(sourcePath);
  const result: InstallResult = {
    agentBinaryInstalled: false,
    unitFileInstalled: false,
    daemonReloaded: false,
    templateParseable: false,
  };

  // install binary if changed (byte-equal comparison)
  let needBinaryWrite = !existsSync(destPath);
  if (!needBinaryWrite) {
    const existingContent = readFileSync(destPath);
    needBinaryWrite = !existingContent.equals(sourceContent);
  }
  if (needBinaryWrite) {
    if (!dryRun) {
      copyFileSync(sourcePath, destPath);
      chmodSync(destPath, 0o755);
    }
    result.agentBinaryInstalled = true;
  }

  // install unit file if changed (text-equal comparison)
  const unitContent = generateAgentUnit();
  let needUnitWrite = !existsSync(unitPath);
  if (!needUnitWrite) {
    const existing = readFileSync(unitPath, 'utf-8');
    needUnitWrite = existing !== unitContent;
  }
  if (needUnitWrite) {
    if (!dryRun) {
      writeFileSync(unitPath, unitContent);
      chmodSync(unitPath, 0o644);
    }
    result.unitFileInstalled = true;
  }

  // daemon-reload only if we wrote something
  if ((result.agentBinaryInstalled || result.unitFileInstalled) && !dryRun) {
    const r = execSafe('systemctl', ['daemon-reload']);
    if (!r.ok) throw new SecretsError(`systemctl daemon-reload failed: ${r.stderr}`);
    result.daemonReloaded = true;
  }

  // verify template is parseable (soft check — not thrown on failure)
  if (!dryRun) {
    const r = execSafe('systemctl', ['cat', 'fleet-secrets-agent@verify.service']);
    result.templateParseable = r.ok;
  } else {
    result.templateParseable = true;
  }

  return result;
}
