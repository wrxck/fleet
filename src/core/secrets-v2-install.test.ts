import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// tests 7 and 8 need a mock for execSafe; tests 1-6 also mock exec
// because systemctl is not available in the test environment.

import { installV2 } from './secrets-v2-install';
import { SecretsError } from './errors';
import { generateAgentUnit } from '../templates/agent-unit';

vi.mock('./exec.js', () => ({
  execSafe: vi.fn(() => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })),
}));

let TMP: string;
let agentSrc: string;
let destBinary: string;
let unitFile: string;

beforeEach(async () => {
  TMP = mkdtempSync(join(tmpdir(), 'fleet-v2-install-'));
  agentSrc = join(TMP, 'fleet-agent.js');
  destBinary = join(TMP, 'bin', 'fleet-agent');
  unitFile = join(TMP, 'fleet-secrets-agent@.service');

  // ensure the bin subdir for destBinary exists
  mkdirSync(join(TMP, 'bin'), { recursive: true });

  // reset the execSafe mock to ok=true before each test
  const { execSafe } = await import('./exec.js');
  vi.mocked(execSafe).mockReturnValue({ ok: true, stdout: '', stderr: '', exitCode: 0 });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('installV2', () => {
  it('test 1: first install — binary and unit installed, daemonReloaded, templateParseable', async () => {
    writeFileSync(agentSrc, '#!/usr/bin/env node\nconsole.log("agent");');

    const result = await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    expect(result.agentBinaryInstalled).toBeTruthy();
    expect(result.unitFileInstalled).toBeTruthy();
    expect(result.daemonReloaded).toBeTruthy();
    expect(result.templateParseable).toBeTruthy();

    // files were actually written
    expect(existsSync(destBinary)).toBeTruthy();
    expect(existsSync(unitFile)).toBeTruthy();
  });

  it('test 2: idempotent re-run — nothing changes (binary and unit already current)', async () => {
    const srcContent = '#!/usr/bin/env node\nconsole.log("agent");';
    writeFileSync(agentSrc, srcContent);

    // first install
    await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    const { execSafe } = await import('./exec.js');
    vi.mocked(execSafe).mockClear();

    // second install — should be no-op
    const result = await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    expect(result.agentBinaryInstalled).toBeFalsy();
    expect(result.unitFileInstalled).toBeFalsy();
    expect(result.daemonReloaded).toBeFalsy();
    // templateParseable is still checked even on idempotent run
    expect(result.templateParseable).toBeTruthy();
  });

  it('test 3: source binary missing — throws SecretsError with "npm run build"', async () => {
    // agentSrc does not exist
    let thrown: unknown;
    try {
      await installV2({
        agentSourcePath: agentSrc,
        destBinaryPath: destBinary,
        unitFilePath: unitFile,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SecretsError);
    expect((thrown as SecretsError).message).toContain('npm run build');
  });

  it('test 4: dry run — no actual writes, result reports what would happen', async () => {
    writeFileSync(agentSrc, '#!/usr/bin/env node\nconsole.log("agent");');

    const result = await installV2({
      dryRun: true,
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    // would install both
    expect(result.agentBinaryInstalled).toBeTruthy();
    expect(result.unitFileInstalled).toBeTruthy();
    expect(result.daemonReloaded).toBeFalsy(); // not reloaded in dry-run
    expect(result.templateParseable).toBeTruthy(); // assumed true in dry-run

    // no actual files written
    expect(existsSync(destBinary)).toBeFalsy();
    expect(existsSync(unitFile)).toBeFalsy();
  });

  it('test 5: binary content changed — binary re-installed', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old");';
    const newContent = '#!/usr/bin/env node\nconsole.log("new");';

    writeFileSync(agentSrc, oldContent);

    // first install
    await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    // change source
    writeFileSync(agentSrc, newContent);

    const result = await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    expect(result.agentBinaryInstalled).toBeTruthy();
    // unit hasn't changed
    expect(result.unitFileInstalled).toBeFalsy();

    // dest has new content
    expect(readFileSync(destBinary, 'utf-8')).toBe(newContent);
  });

  it('test 6: unit content changed — unit re-installed', async () => {
    writeFileSync(agentSrc, '#!/usr/bin/env node\nconsole.log("agent");');
    const vaultPath = '/var/lib/fleet/vault';

    // first install
    await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
      vaultPath,
    });

    // tamper with the unit file
    writeFileSync(unitFile, '[Unit]\nDescription=Old\n');

    const result = await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
      vaultPath,
    });

    expect(result.unitFileInstalled).toBeTruthy();
    // binary hasn't changed
    expect(result.agentBinaryInstalled).toBeFalsy();

    // unit restored to generated content
    expect(readFileSync(unitFile, 'utf-8')).toBe(generateAgentUnit(vaultPath));
  });

  it('test 7: daemon-reload failure — throws SecretsError', async () => {
    writeFileSync(agentSrc, '#!/usr/bin/env node\nconsole.log("agent");');

    const { execSafe } = await import('./exec.js');
    vi.mocked(execSafe).mockImplementation((cmd, args) => {
      if (cmd === 'systemctl' && args[0] === 'daemon-reload') {
        return { ok: false, stdout: '', stderr: 'Failed to reload', exitCode: 1 };
      }
      return { ok: true, stdout: '', stderr: '', exitCode: 0 };
    });

    let thrown: unknown;
    try {
      await installV2({
        agentSourcePath: agentSrc,
        destBinaryPath: destBinary,
        unitFilePath: unitFile,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SecretsError);
    expect((thrown as SecretsError).message).toContain('daemon-reload failed');
  });

  it('test 8: template parse failure — templateParseable=false, not thrown', async () => {
    writeFileSync(agentSrc, '#!/usr/bin/env node\nconsole.log("agent");');

    const { execSafe } = await import('./exec.js');
    vi.mocked(execSafe).mockImplementation((cmd, args) => {
      if (cmd === 'systemctl' && args[0] === 'cat') {
        return { ok: false, stdout: '', stderr: 'No such unit', exitCode: 1 };
      }
      return { ok: true, stdout: '', stderr: '', exitCode: 0 };
    });

    const result = await installV2({
      agentSourcePath: agentSrc,
      destBinaryPath: destBinary,
      unitFilePath: unitFile,
    });

    // does not throw — soft check only
    expect(result.templateParseable).toBeFalsy();
    // install still proceeded
    expect(result.agentBinaryInstalled).toBeTruthy();
    expect(result.unitFileInstalled).toBeTruthy();
    expect(result.daemonReloaded).toBeTruthy();
  });
});
