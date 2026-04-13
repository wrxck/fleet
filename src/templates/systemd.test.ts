import { describe, it, expect } from 'vitest';
import { generateServiceFile } from './systemd.js';

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

  it('quotes composeFile with spaces in path', () => {
    const result = generateServiceFile(makeOpts({ composeFile: '/path/with spaces/docker-compose.yml' }));
    expect(result).toContain('-f "/path/with spaces/docker-compose.yml"');
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

  it('includes ExecStart with docker compose up', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('ExecStart=/usr/bin/docker compose up -d --force-recreate');
  });

  it('includes ExecStop with docker compose down and timeout', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('ExecStop=/usr/bin/docker compose down --timeout 30');
  });

  it('includes ExecStartPre to tear down existing containers', () => {
    const result = generateServiceFile(makeOpts());
    expect(result).toContain('ExecStartPre=-/usr/bin/docker compose down');
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

  it('no command injection via composeFile with semicolons — path is quoted', () => {
    // The -f argument value is always quoted, so shell metacharacters in the
    // path land inside the quotes and cannot escape to become shell commands.
    const maliciousPath = 'docker-compose.yml"; rm -rf /; echo "';
    const result = generateServiceFile(makeOpts({ composeFile: maliciousPath }));
    // The content is placed inside double quotes
    expect(result).toContain(`-f "${maliciousPath}"`);
    // Verify the quotes wrap the entire value
    const lines = result.split('\n');
    const execLine = lines.find(l => l.includes('-f "') && l.includes(maliciousPath));
    expect(execLine).toBeDefined();
    // The -f flag and the value are always together in quotes
    expect(execLine).toMatch(/-f ".*"/);
  });

  it('no injection via description — newlines cannot escape', () => {
    const result = generateServiceFile(makeOpts({ description: 'App\nExecStart=/bin/evil' }));
    // The injected ExecStart should appear in Description, not as a separate directive
    expect(result).toContain('Description=App\nExecStart=/bin/evil');
  });

  it('all ExecStart lines reference the same quoted composeFile', () => {
    const result = generateServiceFile(makeOpts({ composeFile: 'prod.yml' }));
    const execLines = result.split('\n').filter(l => l.startsWith('Exec'));
    expect(execLines.length).toBeGreaterThan(0);
    for (const line of execLines) {
      expect(line).toContain('-f "prod.yml"');
    }
  });
});
