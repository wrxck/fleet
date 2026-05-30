import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { isInsideGitCheckout, resolveDaemonEntry, generateMcpService } from './mcp-units';

describe('isInsideGitCheckout', () => {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('detects a .git ancestor', () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-co-'));
    made.push(root);
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    const entry = join(root, 'dist', 'index.js');
    writeFileSync(entry, '');
    expect(isInsideGitCheckout(entry)).toBeTruthy();
  });

  it('returns false when no .git ancestor exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-pkg-'));
    made.push(root);
    mkdirSync(join(root, 'dist'), { recursive: true });
    const entry = join(root, 'dist', 'index.js');
    writeFileSync(entry, '');
    expect(isInsideGitCheckout(entry)).toBeFalsy();
  });
});

describe('resolveDaemonEntry / generateMcpService', () => {
  it('reports fromCheckout for the dev tree and the unit references the chosen entry', () => {
    // this repo is itself a git checkout, and the global module symlinks back to it,
    // so the resolver must fall back to the local dist and flag it.
    const { entry, fromCheckout } = resolveDaemonEntry();
    expect(fromCheckout).toBeTruthy();
    expect(generateMcpService()).toContain(`ExecStart=/usr/bin/node ${entry} mcp daemon`);
  });
});
