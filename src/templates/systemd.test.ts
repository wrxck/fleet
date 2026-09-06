import { describe, it, expect } from 'vitest';
import { generateServiceFile } from './systemd';

function makeOpts(overrides: Partial<Parameters<typeof generateServiceFile>[0]> = {}) {
  return {
    serviceName: 'myapp',
    description: 'My App Docker Service',
    workingDirectory: '/opt/apps/myapp',
    composeFile: null,
    dependsOnDatabases: false,
    ...overrides,
  };
}

describe('generateServiceFile', () => {
  it('generates a valid systemd unit file structure', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('[Unit]');
    expect(result).toContain('[Service]');
    expect(result).toContain('[Install]');
  });

  it('includes the description in the Unit section', () => {
    const result = generateServiceFile(makeOpts({ description: 'Test Description' }));
    expect(result).toContain('Description=Test Description');
  });

  it('includes WorkingDirectory', () => {
    const result = generateServiceFile(makeOpts({ workingDirectory: '/opt/apps/myapp' }));
    expect(result).toContain('WorkingDirectory=/opt/apps/myapp');
  });

  it('does not include -f flag when composeFile is null', () => {
    const result = generateServiceFile(makeOpts({ composeFile: null }));
    expect(result).not.toContain(' -f ');
  });

  it('includes quoted -f flag when composeFile is provided', () => {
    const result = generateServiceFile(makeOpts({ composeFile: 'docker-compose.prod.yml' }));
    expect(result).toContain('-f "docker-compose.prod.yml"');
  });

  it('rejects composeFile with spaces (must be a bare safe filename)', () => {
    expect(() =>
      generateServiceFile(makeOpts({ composeFile: '/path/with spaces/docker-compose.yml' })),
    ).toThrow(/compose filename/);
  });

  it('does not depend on docker-databases when dependsOnDatabases is false', () => {
    const result = generateServiceFile(makeOpts({ dependsOnDatabases: false }));
    expect(result).not.toContain('docker-databases.service');
  });

  it('adds docker-databases dependency when dependsOnDatabases is true', () => {
    const result = generateServiceFile(makeOpts({ dependsOnDatabases: true }));
    expect(result).toContain('docker-databases.service');
    expect(result).toContain('Requires=docker.service docker-databases.service');
    expect(result).toContain('After=docker.service docker-databases.service');
  });

  it('includes ExecStart with fleet boot-start', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('ExecStart=/usr/bin/env fleet boot-start myapp');
  });

  it('includes ExecStop with docker compose down and timeout', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('ExecStop=/usr/bin/docker compose down --timeout 30');
  });

  it('emits no ExecStartPre teardown — it would destroy a container dockerd restarted', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).not.toContain('ExecStartPre=');
  });

  it('puts the start rate limit in [Unit], where systemd actually reads it', () => {
    const result = generateServiceFile(makeOpts());
    const unitSection = result.slice(result.indexOf('[Unit]'), result.indexOf('[Service]'));
    expect(unitSection).toContain('StartLimitIntervalSec=300');
    expect(unitSection).toContain('StartLimitBurst=5');
    const serviceSection = result.slice(result.indexOf('[Service]'));
    expect(serviceSection).not.toContain('StartLimit');
  });

  it('omits the unseal dependency by default', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).not.toContain('fleet-unseal.service');
  });

  it('adds the unseal dependency to both Requires and After when asked', () => {
    const result = generateServiceFile(makeOpts({ requiresUnseal: true }));
    expect(result).toContain('Requires=docker.service fleet-unseal.service');
    expect(result).toContain('After=docker.service fleet-unseal.service network-online.target');
  });

  it('orders the unseal after the database dependency when both apply', () => {
    const result = generateServiceFile(makeOpts({ dependsOnDatabases: true, requiresUnseal: true }));
    expect(result).toContain('Requires=docker.service docker-databases.service fleet-unseal.service');
    expect(result).toContain('After=docker.service docker-databases.service fleet-unseal.service network-online.target');
  });

  it('includes ExecReload with docker compose restart', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('ExecReload=/usr/bin/docker compose restart');
  });

  it('is of type oneshot with RemainAfterExit', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('Type=oneshot');
    expect(result).toContain('RemainAfterExit=yes');
  });

  it('has WantedBy=multi-user.target', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('WantedBy=multi-user.target');
  });

  it('has restart policy', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('Restart=on-failure');
    expect(result).toContain('RestartSec=10');
  });

  it('rejects composeFile that tries to break out of the quoted -f argument', () => {
    // The -f argument is interpolated into a systemd ExecStart directive.
    // If a value containing a closing quote and another -f flag were
    // accepted, the rendered unit would invoke a second compose file under
    // attacker control, e.g. `docker compose -f "evil.yml" -f "/tmp/x.yml" down`.
    // The validator must reject any quote/space/-f-injection attempt up front.
    const malicious = 'evil.yml" -f "/tmp/attacker.yml';
    expect(() => generateServiceFile(makeOpts({ composeFile: malicious }))).toThrow(/compose filename/);
  });

  it('rejects composeFile containing shell metacharacters', () => {
    expect(() =>
      generateServiceFile(makeOpts({ composeFile: 'docker-compose.yml; rm -rf /' })),
    ).toThrow(/compose filename/);
    expect(() =>
      generateServiceFile(makeOpts({ composeFile: 'docker-compose.yml"; rm -rf /; echo "' })),
    ).toThrow(/compose filename/);
  });

  it('rejects composeFile containing path separators', () => {
    expect(() =>
      generateServiceFile(makeOpts({ composeFile: '/etc/passwd.yml' })),
    ).toThrow(/compose filename/);
    expect(() =>
      generateServiceFile(makeOpts({ composeFile: '../etc/passwd.yml' })),
    ).toThrow(/compose filename/);
  });

  it('accepts a clean compose filename and emits the expected -f flag', () => {
    const result = generateServiceFile(makeOpts({ composeFile: 'docker-compose.yml' }));
    expect(result).toContain('-f "docker-compose.yml"');
    expect(result).toContain('ExecStop=/usr/bin/docker compose -f "docker-compose.yml" down --timeout 30');
    expect(result).toContain('ExecReload=/usr/bin/docker compose -f "docker-compose.yml" restart');
  });

  it('no injection via description — newlines cannot escape', () => {
    const result = generateServiceFile(makeOpts({ description: 'App\nExecStart=/bin/evil' }));
    // The injected ExecStart should appear in Description, not as a separate directive
    expect(result).toContain('Description=App\nExecStart=/bin/evil');
  });

  it('all Exec lines except ExecStart reference the same quoted composeFile', () => {
    const result = generateServiceFile(makeOpts({ composeFile: 'prod.yml' }));
    const execLines = result.split('\n').filter(l => l.startsWith('Exec') && !l.startsWith('ExecStart='));
    expect(execLines.length).toBeGreaterThan(0);
    for (const line of execLines) {
      expect(line).toContain('-f "prod.yml"');
    }
  });
});

describe('boot-start integration in template', () => {
  it('uses fleet boot-start as ExecStart with the service name', () => {
    const content = generateServiceFile({
      serviceName: 'sample',
      description: 'sample',
      workingDirectory: '/home/operator/sample',
      composeFile: null,
      dependsOnDatabases: false,
    });
    expect(content).toContain('ExecStart=/usr/bin/env fleet boot-start sample');
    expect(content).not.toContain('ExecStart=/usr/bin/docker compose');
  });

  it('bumps TimeoutStartSec to 900 to accommodate refresh cap', () => {
    const content = generateServiceFile({
      serviceName: 'sample',
      description: 'sample',
      workingDirectory: '/home/operator/sample',
      composeFile: null,
      dependsOnDatabases: false,
    });
    expect(content).toContain('TimeoutStartSec=900');
    expect(content).not.toContain('TimeoutStartSec=300');
  });

  it('keeps ExecStop as compose down and drops the ExecStartPre teardown', () => {
    const content = generateServiceFile({
      serviceName: 'sample',
      description: 'sample',
      workingDirectory: '/home/operator/sample',
      composeFile: null,
      dependsOnDatabases: false,
    });
    // the teardown before start is gone: at boot it destroys the container
    // dockerd has already restarted, and a start that then fails leaves nothing
    expect(content).not.toContain('ExecStartPre=');
    // stopping the unit still tears the stack down
    expect(content).toContain('ExecStop=/usr/bin/docker compose down --timeout 30');
  });
});
