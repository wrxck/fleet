import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { type Routine } from '../../core/routines/schema.js';
import { renderUnits, createSystemdTimerAdapter } from './systemd-timer.js';

const mkCalendarRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: 'nightly-audit',
  name: 'Nightly Audit',
  description: '',
  schedule: {
    kind: 'calendar',
    onCalendar: '*-*-* 02:00:00',
    randomizedDelaySec: 300,
    persistent: true,
  },
  enabled: true,
  targets: [],
  perTarget: false,
  task: { kind: 'shell', argv: ['echo', 'run'], wallClockMs: 60_000 },
  notify: [],
  tags: [],
  ...overrides,
});

describe('renderUnits', () => {
  it('returns null for a manual routine', () => {
    const r = mkCalendarRoutine({ schedule: { kind: 'manual' } });
    expect(renderUnits(r)).toBeNull();
  });

  it('includes OnCalendar, RandomizedDelay, Persistent in the timer unit', () => {
    const out = renderUnits(mkCalendarRoutine());
    expect(out).not.toBeNull();
    expect(out!.timerUnit).toContain('OnCalendar=*-*-* 02:00:00');
    expect(out!.timerUnit).toContain('RandomizedDelaySec=300');
    expect(out!.timerUnit).toContain('Persistent=true');
  });

  it('produces the correct unit name and paths', () => {
    const out = renderUnits(mkCalendarRoutine(), { unitDir: '/tmp/fleet-units' });
    expect(out!.unitName).toBe('fleet-routine-nightly-audit');
    expect(out!.timerPath).toBe('/tmp/fleet-units/fleet-routine-nightly-audit.timer');
    expect(out!.servicePath).toBe('/tmp/fleet-units/fleet-routine-nightly-audit.service');
  });

  it('includes all required hardening directives', () => {
    const out = renderUnits(mkCalendarRoutine());
    const required = [
      'NoNewPrivileges=true',
      'PrivateTmp=true',
      'ProtectSystem=strict',
      'ProtectHome=read-only',
      'LockPersonality=true',
      'RestrictSUIDSGID=true',
    ];
    for (const directive of required) {
      expect(out!.serviceUnit, `missing: ${directive}`).toContain(directive);
    }
  });

  it('exposes a journal-logged oneshot ExecStart using the fleet binary', () => {
    const out = renderUnits(mkCalendarRoutine(), { fleetBinary: '/opt/fleet/bin/fleet' });
    expect(out!.serviceUnit).toContain('Type=oneshot');
    expect(out!.serviceUnit).toContain('StandardOutput=journal');
    expect(out!.serviceUnit).toContain('/opt/fleet/bin/fleet routine-run --id nightly-audit');
  });

  it('omits User= when runAsUser is not provided', () => {
    const out = renderUnits(mkCalendarRoutine());
    expect(out!.serviceUnit).not.toMatch(/^User=/m);
  });

  it('includes User= when runAsUser is provided', () => {
    const out = renderUnits(mkCalendarRoutine(), { runAsUser: 'fleet' });
    expect(out!.serviceUnit).toMatch(/^User=fleet$/m);
  });
});

describe('createSystemdTimerAdapter (file I/O only)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleet-units-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports its id', () => {
    const a = createSystemdTimerAdapter({ unitDir: dir });
    expect(a.id).toBe('systemd-timer');
  });

  it('writes both unit files on disk (systemctl calls excluded from unit test)', async () => {
    const routine = mkCalendarRoutine();
    const rendered = renderUnits(routine, { unitDir: dir });
    expect(rendered).not.toBeNull();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(rendered!.servicePath, rendered!.serviceUnit);
    writeFileSync(rendered!.timerPath, rendered!.timerUnit);
    expect(existsSync(rendered!.timerPath)).toBeTruthy();
    expect(existsSync(rendered!.servicePath)).toBeTruthy();
    expect(readFileSync(rendered!.timerPath, 'utf-8')).toContain('OnCalendar=');
  });
});
