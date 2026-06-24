import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { isInsideGitCheckout, resolveDaemonEntry, generateMcpService, generateMcpSocket } from './mcp-units';

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

  it('service requires the socket unit', () => {
    expect(generateMcpService()).toContain('Requires=fleet-mcp.socket');
  });

  it('does NOT declare RuntimeDirectory on the service (the socket owns it)', () => {
    // a second RuntimeDirectory= would let a service restart remove the dir +
    // live socket the .socket unit owns.
    expect(generateMcpService()).not.toContain('RuntimeDirectory');
  });
});

describe('generateMcpSocket', () => {
  it('binds the socket with a guard-group 0660 acl that systemd owns', () => {
    const unit = generateMcpSocket();
    expect(unit).toContain('ListenStream=/run/fleet-mcp/mcp.sock');
    expect(unit).toContain('SocketGroup=fleet-guard');
    expect(unit).toContain('SocketMode=0660');
    expect(unit).toContain('WantedBy=sockets.target');
  });

  it('does NOT couple the socket to the service via PartOf', () => {
    // coupling the socket lifecycle to the service would restart the socket
    // whenever the service restarts, dropping the listening fd and defeating
    // socket activation.
    expect(generateMcpSocket()).not.toContain('PartOf');
  });
});
