import { describe, it, expect } from 'vitest';

import { generateAgentUnit } from './agent-unit.js';

describe('generateAgentUnit', () => {
  it('returns a string', () => {
    expect(typeof generateAgentUnit()).toBe('string');
  });

  it('includes [Unit], [Service], [Install] sections', () => {
    const unit = generateAgentUnit();
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
  });

  it('uses %i for app name parameterisation', () => {
    const unit = generateAgentUnit();
    expect(unit).toContain('Description=Fleet Secrets Agent for %i');
    expect(unit).toContain('LoadCredentialEncrypted=age-key:/etc/fleet/credentials/%i.cred');
    expect(unit).toMatch(/--app %i/);
    expect(unit).toMatch(/--socket \/run\/fleet-secrets\/%i\.sock/);
  });

  it('runs as DynamicUser=yes', () => {
    expect(generateAgentUnit()).toContain('DynamicUser=yes');
  });

  it('declares Type=notify', () => {
    expect(generateAgentUnit()).toContain('Type=notify');
  });

  it('uses LoadCredentialEncrypted for the age private key', () => {
    expect(generateAgentUnit()).toContain('LoadCredentialEncrypted=age-key:/etc/fleet/credentials/%i.cred');
  });

  it('hardening: includes ProtectSystem=strict', () => {
    expect(generateAgentUnit()).toContain('ProtectSystem=strict');
  });

  it('hardening: restricts address families to AF_UNIX', () => {
    expect(generateAgentUnit()).toContain('RestrictAddressFamilies=AF_UNIX');
  });

  it('hardening: blocks privileged syscalls', () => {
    const unit = generateAgentUnit();
    expect(unit).toContain('SystemCallFilter=@system-service');
    expect(unit).toContain('SystemCallFilter=~@privileged @resources @mount');
  });

  it('vault dir is read-only', () => {
    expect(generateAgentUnit()).toContain('ReadOnlyPaths=/home/matt/fleet/vault');
  });

  it('starts on multi-user target', () => {
    expect(generateAgentUnit()).toContain('WantedBy=multi-user.target');
  });

  it('PartOf=docker-%i.service for unit grouping', () => {
    expect(generateAgentUnit()).toContain('PartOf=docker-%i.service');
  });

  it('agent binary path is /usr/local/bin/fleet-agent', () => {
    expect(generateAgentUnit()).toContain('ExecStart=/usr/local/bin/fleet-agent');
  });
});
