import { describe, it, expect } from 'vitest';

import { generateAgentUnit } from './agent-unit';

const VAULT = '/var/lib/fleet/vault';

describe('generateAgentUnit', () => {
  it('returns a string', () => {
    expect(typeof generateAgentUnit(VAULT)).toBe('string');
  });

  it('includes [Unit], [Service], [Install] sections', () => {
    const unit = generateAgentUnit(VAULT);
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
  });

  it('uses %i for app name parameterisation', () => {
    const unit = generateAgentUnit(VAULT);
    expect(unit).toContain('Description=Fleet Secrets Agent for %i');
    expect(unit).toContain('LoadCredentialEncrypted=age-key:/etc/fleet/credentials/%i.cred');
    expect(unit).toMatch(/--app %i/);
    expect(unit).toMatch(/--socket \/run\/fleet-secrets\/%i\.sock/);
  });

  it('runs as DynamicUser=yes', () => {
    expect(generateAgentUnit(VAULT)).toContain('DynamicUser=yes');
  });

  it('declares Type=notify', () => {
    expect(generateAgentUnit(VAULT)).toContain('Type=notify');
  });

  it('uses LoadCredentialEncrypted for the age private key', () => {
    expect(generateAgentUnit(VAULT)).toContain('LoadCredentialEncrypted=age-key:/etc/fleet/credentials/%i.cred');
  });

  it('hardening: includes ProtectSystem=strict', () => {
    expect(generateAgentUnit(VAULT)).toContain('ProtectSystem=strict');
  });

  it('hardening: restricts address families to AF_UNIX', () => {
    expect(generateAgentUnit(VAULT)).toContain('RestrictAddressFamilies=AF_UNIX');
  });

  it('hardening: blocks privileged syscalls', () => {
    const unit = generateAgentUnit(VAULT);
    expect(unit).toContain('SystemCallFilter=@system-service');
    expect(unit).toContain('SystemCallFilter=~@privileged @resources @mount');
  });

  it('vault dir is read-only and taken from the caller', () => {
    expect(generateAgentUnit(VAULT)).toContain(`ReadOnlyPaths=${VAULT}`);
  });

  it('agent ExecStart embeds the supplied vault path', () => {
    expect(generateAgentUnit(VAULT)).toContain(`--vault ${VAULT}`);
  });

  it('honours an alternative vault path verbatim', () => {
    const alt = '/srv/fleet/encrypted';
    const unit = generateAgentUnit(alt);
    expect(unit).toContain(`--vault ${alt}`);
    expect(unit).toContain(`ReadOnlyPaths=${alt}`);
  });

  it('starts on multi-user target', () => {
    expect(generateAgentUnit(VAULT)).toContain('WantedBy=multi-user.target');
  });

  it('PartOf=docker-%i.service for unit grouping', () => {
    expect(generateAgentUnit(VAULT)).toContain('PartOf=docker-%i.service');
  });

  it('agent binary path is /usr/local/bin/fleet-agent', () => {
    expect(generateAgentUnit(VAULT)).toContain('ExecStart=/usr/local/bin/fleet-agent');
  });
});
