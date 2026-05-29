import { describe, it, expect } from 'vitest';

import { addAgentDependency, removeAgentDependency } from './app-unit-edit';

// A realistic systemd unit fixture matching what fleet generates
const FIXTURE = `[Unit]
Description=My App Docker Service
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/matt/my-app
ExecStartPre=-/usr/bin/docker compose down
ExecStart=/usr/bin/env fleet boot-start my-app
ExecStop=/usr/bin/docker compose down --timeout 30
ExecReload=/usr/bin/docker compose restart
TimeoutStartSec=900
TimeoutStopSec=60
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

describe('addAgentDependency', () => {
  it('adds both Requires= and After= lines under [Unit]', () => {
    const result = addAgentDependency(FIXTURE, 'my-app');
    expect(result).toContain('Requires=fleet-secrets-agent@my-app.service');
    expect(result).toContain('After=fleet-secrets-agent@my-app.service');
  });

  it('is idempotent — calling twice returns the same content', () => {
    const once = addAgentDependency(FIXTURE, 'my-app');
    const twice = addAgentDependency(once, 'my-app');
    expect(twice).toBe(once);
  });

  it('adds only the missing line when one already exists', () => {
    // manually insert just the requires line
    const partial = FIXTURE.replace(
      'Wants=network-online.target',
      'Wants=network-online.target\nRequires=fleet-secrets-agent@my-app.service',
    );
    const result = addAgentDependency(partial, 'my-app');
    // after= should now be added
    expect(result).toContain('After=fleet-secrets-agent@my-app.service');
    // requires= should still be present exactly once
    const count = result.split('Requires=fleet-secrets-agent@my-app.service').length - 1;
    expect(count).toBe(1);
  });

  it('does not disturb other [Unit] entries', () => {
    const result = addAgentDependency(FIXTURE, 'my-app');
    expect(result).toContain('Description=My App Docker Service');
    expect(result).toContain('Requires=docker.service');
    expect(result).toContain('After=docker.service network-online.target');
    expect(result).toContain('Wants=network-online.target');
  });

  it('does not add lines outside [Unit] — [Service] and [Install] are untouched', () => {
    const result = addAgentDependency(FIXTURE, 'my-app');
    const lines = result.split('\n');
    const serviceIdx = lines.indexOf('[Service]');
    const agentLines = lines
      .slice(serviceIdx)
      .filter(l => l.includes('fleet-secrets-agent@my-app.service'));
    expect(agentLines).toHaveLength(0);
  });

  it('throws when there is no [Unit] section', () => {
    const broken = `[Service]\nExecStart=/bin/true\n`;
    expect(() => addAgentDependency(broken, 'my-app')).toThrow('no [Unit] section found');
  });
});

describe('removeAgentDependency', () => {
  it('removes both Requires= and After= lines', () => {
    const withDeps = addAgentDependency(FIXTURE, 'my-app');
    const result = removeAgentDependency(withDeps, 'my-app');
    expect(result).not.toContain('Requires=fleet-secrets-agent@my-app.service');
    expect(result).not.toContain('After=fleet-secrets-agent@my-app.service');
  });

  it('is idempotent — removing from a file that never had the lines is safe', () => {
    const result = removeAgentDependency(FIXTURE, 'my-app');
    expect(result).toBe(FIXTURE);
  });

  it('does not remove unrelated Requires= or After= entries', () => {
    const withDeps = addAgentDependency(FIXTURE, 'my-app');
    const result = removeAgentDependency(withDeps, 'my-app');
    expect(result).toContain('Requires=docker.service');
    expect(result).toContain('After=docker.service network-online.target');
  });

  it('round-trips: add → remove returns original content', () => {
    const withDeps = addAgentDependency(FIXTURE, 'my-app');
    const result = removeAgentDependency(withDeps, 'my-app');
    expect(result).toBe(FIXTURE);
  });
});
