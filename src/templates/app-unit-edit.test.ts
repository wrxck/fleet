import { describe, it, expect } from 'vitest';

import {
  addAgentDependency,
  addUnsealDependency,
  ensureStartLimitInUnit,
  hasTeardownExecStartPre,
  removeAgentDependency,
  removeTeardownExecStartPre,
  startLimitNeedsFix,
} from './app-unit-edit';

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

// a unit as fleet generated it before the boot-resilience fix: the start rate
// limit sits in [Service], where systemd ignores it.
const LEGACY_UNIT = `[Unit]
Description=Legacy App
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
StartLimitBurst=5
StartLimitIntervalSec=300
Type=oneshot
ExecStartPre=-/usr/bin/docker compose down
ExecStart=/usr/bin/env fleet boot-start legacy
ExecStop=/usr/bin/docker compose down --timeout 30

[Install]
WantedBy=multi-user.target
`;

describe('addUnsealDependency', () => {
  it('adds Requires= and After= for the unseal unit under [Unit]', () => {
    const result = addUnsealDependency(FIXTURE);
    const unit = result.slice(result.indexOf('[Unit]'), result.indexOf('[Service]'));
    expect(unit).toContain('Requires=fleet-unseal.service');
    expect(unit).toContain('After=fleet-unseal.service');
  });

  it('is idempotent', () => {
    const once = addUnsealDependency(FIXTURE);
    expect(addUnsealDependency(once)).toBe(once);
  });

  it('recognises the unit inside a combined Requires= directive', () => {
    const combined = FIXTURE
      .replace('Requires=docker.service', 'Requires=docker.service fleet-unseal.service')
      .replace(
        'After=docker.service network-online.target',
        'After=docker.service fleet-unseal.service network-online.target',
      );
    expect(addUnsealDependency(combined)).toBe(combined);
  });

  it('does not treat a different unit as a match on a substring', () => {
    const other = FIXTURE.replace('Requires=docker.service', 'Requires=my-fleet-unseal.service');
    expect(addUnsealDependency(other)).toContain('Requires=fleet-unseal.service');
  });

  it('leaves a unit with no [Unit] section untouched instead of throwing', () => {
    const broken = '[Service]\nExecStart=/bin/true\n';
    expect(addUnsealDependency(broken)).toBe(broken);
  });
});

describe('startLimitNeedsFix / ensureStartLimitInUnit', () => {
  it('flags a unit whose start rate limit sits in [Service]', () => {
    expect(startLimitNeedsFix(LEGACY_UNIT)).toBe(true);
  });

  it('flags a unit with no start rate limit at all', () => {
    expect(startLimitNeedsFix(FIXTURE)).toBe(true);
  });

  it('leaves a unit alone once the directives are in [Unit]', () => {
    const fixed = ensureStartLimitInUnit(LEGACY_UNIT);
    expect(startLimitNeedsFix(fixed)).toBe(false);
    expect(ensureStartLimitInUnit(fixed)).toBe(fixed);
  });

  it('moves the directives out of [Service] and into [Unit]', () => {
    const result = ensureStartLimitInUnit(LEGACY_UNIT);
    const unit = result.slice(result.indexOf('[Unit]'), result.indexOf('[Service]'));
    const service = result.slice(result.indexOf('[Service]'));
    expect(unit).toContain('StartLimitIntervalSec=300');
    expect(unit).toContain('StartLimitBurst=5');
    expect(service).not.toContain('StartLimit');
  });

  it('writes each directive exactly once', () => {
    const result = ensureStartLimitInUnit(LEGACY_UNIT);
    expect(result.match(/StartLimitBurst=/g)).toHaveLength(1);
    expect(result.match(/StartLimitIntervalSec=/g)).toHaveLength(1);
  });

  it('honours custom values', () => {
    const result = ensureStartLimitInUnit(FIXTURE, { intervalSec: 60, burst: 3 });
    expect(result).toContain('StartLimitIntervalSec=60');
    expect(result).toContain('StartLimitBurst=3');
  });

  it('keeps a tuned value already in [Unit] rather than resetting it', () => {
    const tuned = FIXTURE.replace(
      'Wants=network-online.target',
      'Wants=network-online.target\nStartLimitBurst=99',
    );
    expect(startLimitNeedsFix(tuned)).toBe(false);
    expect(ensureStartLimitInUnit(tuned)).toBe(tuned);
  });

  it('reports no fix needed for a unit with no [Unit] section', () => {
    expect(startLimitNeedsFix('[Service]\nStartLimitBurst=5\n')).toBe(false);
  });

  it('also lifts the deprecated StartLimitInterval spelling', () => {
    const legacy = LEGACY_UNIT.replace('StartLimitIntervalSec=300', 'StartLimitInterval=300');
    const service = ensureStartLimitInUnit(legacy).slice(
      ensureStartLimitInUnit(legacy).indexOf('[Service]'),
    );
    expect(service).not.toContain('StartLimit');
  });
});

// systemd strips whitespace around a section header and around "=", and a file
// hand-edited on windows carries CRLF. the edits must see the same structure
// systemd does, or a directive lands in a section where it is ignored.
describe('tolerating real-world unit formatting', () => {
  const trailingSpaceHeader = FIXTURE.replace('[Service]', '[Service] ');
  const crlf = FIXTURE.replace(/\n/g, '\r\n');

  it('does not write into [Service] when its header has trailing whitespace', () => {
    const result = addUnsealDependency(trailingSpaceHeader);
    const serviceStart = result.indexOf('[Service] ');
    expect(result.slice(serviceStart)).not.toContain('Requires=fleet-unseal.service');
    expect(result.slice(0, serviceStart)).toContain('Requires=fleet-unseal.service');
  });

  it('finds a misplaced start rate limit past a padded header', () => {
    const padded = LEGACY_UNIT.replace('[Service]', '[Service] ');
    expect(startLimitNeedsFix(padded)).toBe(true);
    const result = ensureStartLimitInUnit(padded);
    expect(result.slice(result.indexOf('[Service] '))).not.toContain('StartLimit');
  });

  it('does not append past [Install] in a CRLF unit', () => {
    const result = addUnsealDependency(crlf);
    const installAt = result.indexOf('[Install]');
    expect(result.slice(installAt)).not.toContain('Requires=fleet-unseal.service');
  });

  it('finds the teardown in a CRLF unit', () => {
    expect(hasTeardownExecStartPre(crlf)).toBe(true);
    expect(hasTeardownExecStartPre(removeTeardownExecStartPre(crlf))).toBe(false);
  });

  it('finds a start rate limit in a CRLF unit', () => {
    expect(startLimitNeedsFix(LEGACY_UNIT.replace(/\n/g, '\r\n'))).toBe(true);
  });

  it('treats a spaced "Requires = unit" as the same directive', () => {
    const spaced = FIXTURE.replace(
      'Requires=docker.service',
      'Requires = docker.service fleet-unseal.service',
    ).replace(
      'After=docker.service network-online.target',
      'After = docker.service fleet-unseal.service',
    );
    expect(addUnsealDependency(spaced)).toBe(spaced);
  });

  it('finds an indented teardown directive', () => {
    const indented = FIXTURE.replace(
      'ExecStartPre=-/usr/bin/docker compose down',
      '  ExecStartPre=-/usr/bin/docker compose down',
    );
    expect(hasTeardownExecStartPre(indented)).toBe(true);
  });
});

describe('removeTeardownExecStartPre / hasTeardownExecStartPre', () => {
  it('detects and removes the compose-down teardown', () => {
    expect(hasTeardownExecStartPre(FIXTURE)).toBe(true);
    const result = removeTeardownExecStartPre(FIXTURE);
    expect(hasTeardownExecStartPre(result)).toBe(false);
    expect(result).not.toContain('ExecStartPre=');
  });

  it('keeps ExecStop, which is a different directive', () => {
    expect(removeTeardownExecStartPre(FIXTURE)).toContain(
      'ExecStop=/usr/bin/docker compose down --timeout 30',
    );
  });

  it('removes the -f variant too', () => {
    const withFile = FIXTURE.replace(
      'ExecStartPre=-/usr/bin/docker compose down',
      'ExecStartPre=-/usr/bin/docker compose -f "prod.yml" down',
    );
    expect(hasTeardownExecStartPre(withFile)).toBe(true);
    expect(removeTeardownExecStartPre(withFile)).not.toContain('ExecStartPre=');
  });

  it('leaves an unrelated ExecStartPre in place', () => {
    const other = FIXTURE.replace(
      'ExecStartPre=-/usr/bin/docker compose down',
      'ExecStartPre=/usr/bin/mkdir -p /srv/data',
    );
    expect(hasTeardownExecStartPre(other)).toBe(false);
    expect(removeTeardownExecStartPre(other)).toContain('ExecStartPre=/usr/bin/mkdir -p /srv/data');
  });

  it('is idempotent', () => {
    const once = removeTeardownExecStartPre(FIXTURE);
    expect(removeTeardownExecStartPre(once)).toBe(once);
  });
});
