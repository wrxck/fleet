import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import { execSafe } from '../../core/exec.js';
import type { Routine } from '../../core/routines/schema.js';
import type { SchedulerAdapter, ScheduledEntry } from '../types.js';

const UNIT_DIR = '/etc/systemd/system';
const UNIT_PREFIX = 'fleet-routine-';

export interface SystemdTimerOptions {
  fleetBinary?: string;
  runAsUser?: string;
  unitDir?: string;
}

interface RenderedUnit {
  timerPath: string;
  servicePath: string;
  timerUnit: string;
  serviceUnit: string;
  unitName: string;
}

export function renderUnits(
  routine: Routine,
  opts: SystemdTimerOptions = {},
): RenderedUnit | null {
  if (routine.schedule.kind !== 'calendar') return null;

  const fleetBinary = opts.fleetBinary ?? '/usr/local/bin/fleet';
  const unitDir = opts.unitDir ?? UNIT_DIR;
  const unitName = `${UNIT_PREFIX}${routine.id}`;
  const timerPath = `${unitDir}/${unitName}.timer`;
  const servicePath = `${unitDir}/${unitName}.service`;
  const onCalendar = routine.schedule.onCalendar;
  const randomizedDelay = routine.schedule.randomizedDelaySec;
  const persistent = routine.schedule.persistent;

  const userDirective = opts.runAsUser ? `User=${opts.runAsUser}\n` : '';

  const timerUnit = [
    `[Unit]`,
    `Description=Fleet routine ${routine.id} (${routine.name})`,
    ``,
    `[Timer]`,
    `OnCalendar=${onCalendar}`,
    `RandomizedDelaySec=${randomizedDelay}`,
    `Persistent=${persistent ? 'true' : 'false'}`,
    `Unit=${unitName}.service`,
    ``,
    `[Install]`,
    `WantedBy=timers.target`,
    ``,
  ].join('\n');

  const serviceUnit = [
    `[Unit]`,
    `Description=Fleet routine ${routine.id} run`,
    `After=network-online.target`,
    `Wants=network-online.target`,
    ``,
    `[Service]`,
    `Type=oneshot`,
    userDirective,
    `ExecStart=${fleetBinary} routine-run --id ${routine.id}`,
    `NoNewPrivileges=true`,
    `PrivateTmp=true`,
    `ProtectSystem=strict`,
    `ProtectHome=read-only`,
    `ReadWritePaths=/var/log/fleet /var/lib/fleet`,
    `LockPersonality=true`,
    `RestrictSUIDSGID=true`,
    `TimeoutStartSec=3600`,
    `StandardOutput=journal`,
    `StandardError=journal`,
    ``,
  ].filter(Boolean).join('\n');

  return { timerPath, servicePath, timerUnit, serviceUnit, unitName };
}

function parseListTimers(stdout: string): Map<string, { next: string | null; last: string | null }> {
  const map = new Map<string, { next: string | null; last: string | null }>();
  const lines = stdout.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\S.*?)\s+(\S.*?\s+\S+)\s+(.*?)\s+(\S.*?)\s+(.*?)\s+(\S+\.timer)\s+(\S+\.service)/);
    if (!match) continue;
    const [, nextRaw, , lastRaw, , , timerName] = match;
    const baseName = timerName.replace(/\.timer$/, '');
    map.set(baseName, {
      next: nextRaw === 'n/a' || nextRaw === '-' ? null : nextRaw.trim(),
      last: lastRaw === 'n/a' || lastRaw === '-' ? null : lastRaw.trim(),
    });
  }
  return map;
}

function parseActiveStatus(unitName: string): { active: boolean; lastStatus: 'ok' | 'failed' | 'unknown' } {
  const show = execSafe('systemctl', [
    'show', `${unitName}.service`,
    '--property=ActiveState,Result', '--no-pager',
  ]);
  const active = /ActiveState=active|activating/.test(show.stdout);
  const resultMatch = show.stdout.match(/Result=(\S+)/);
  const result = resultMatch?.[1] ?? 'unknown';
  const lastStatus = result === 'success' ? 'ok' : result === 'exit-code' || result === 'signal' ? 'failed' : 'unknown';
  return { active, lastStatus };
}

export function createSystemdTimerAdapter(opts: SystemdTimerOptions = {}): SchedulerAdapter {
  const unitDir = opts.unitDir ?? UNIT_DIR;

  return {
    id: 'systemd-timer',

    available(): boolean {
      const r = execSafe('systemctl', ['--version']);
      return r.ok;
    },

    async upsert(routine: Routine): Promise<void> {
      if (routine.schedule.kind === 'manual') return;
      const rendered = renderUnits(routine, opts);
      if (!rendered) return;
      writeFileSync(rendered.servicePath, rendered.serviceUnit, { mode: 0o644 });
      writeFileSync(rendered.timerPath, rendered.timerUnit, { mode: 0o644 });
      const reload = execSafe('systemctl', ['daemon-reload']);
      if (!reload.ok) throw new Error(`daemon-reload failed: ${reload.stderr}`);
      if (routine.enabled) {
        const enable = execSafe('systemctl', ['enable', '--now', `${rendered.unitName}.timer`]);
        if (!enable.ok) throw new Error(`enable failed: ${enable.stderr}`);
      } else {
        execSafe('systemctl', ['disable', '--now', `${rendered.unitName}.timer`]);
      }
    },

    async remove(routineId: string): Promise<void> {
      const unitName = `${UNIT_PREFIX}${routineId}`;
      const timerPath = `${unitDir}/${unitName}.timer`;
      const servicePath = `${unitDir}/${unitName}.service`;
      execSafe('systemctl', ['disable', '--now', `${unitName}.timer`]);
      if (existsSync(timerPath)) unlinkSync(timerPath);
      if (existsSync(servicePath)) unlinkSync(servicePath);
      execSafe('systemctl', ['daemon-reload']);
    },

    async list(): Promise<ScheduledEntry[]> {
      const timers = execSafe('systemctl', [
        'list-timers', '--all', '--no-pager', '--no-legend', `${UNIT_PREFIX}*`,
      ]);
      if (!timers.ok) return [];
      const parsed = parseListTimers(timers.stdout);
      const entries: ScheduledEntry[] = [];
      for (const [unitName, timing] of parsed) {
        const routineId = unitName.replace(new RegExp(`^${UNIT_PREFIX}`), '');
        const { active, lastStatus } = parseActiveStatus(unitName);
        entries.push({
          routineId,
          unitName,
          nextRunAt: timing.next,
          lastRunAt: timing.last,
          lastStatus,
          active,
          persistent: true,
        });
      }
      return entries;
    },

    async get(routineId: string): Promise<ScheduledEntry | null> {
      const all = await this.list();
      return all.find(e => e.routineId === routineId) ?? null;
    },
  };
}
