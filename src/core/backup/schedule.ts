import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { FleetError } from '../errors';
import { execSafe } from '../exec';

import { Schedule } from './types';

export const SYSTEMD_UNIT_DIR = process.env.FLEET_SYSTEMD_UNIT_DIR ?? '/etc/systemd/system';

function onCalendarFor(schedule: Schedule): string {
  if (schedule === 'hourly') return 'hourly';
  if (schedule === 'daily') return 'daily';
  if (schedule === 'weekly') return 'weekly';
  return schedule;
}

export function timerUnitName(app: string): string {
  return `fleet-backup@${app}.timer`;
}

export function serviceUnitName(app: string): string {
  return `fleet-backup@${app}.service`;
}

export interface ScheduleInstallResult {
  timerPath: string;
  timerContent: string;
  sharedServicePath: string;
  sharedServiceContent: string;
  sharedServiceWrote: boolean;
}

/** plans the timer + service units. returns the unit file contents so callers
 *  can show a dry-run. set apply=true to actually write+enable. */
export function installScheduleUnits(app: string, schedule: Schedule, opts: { apply?: boolean } = {}): ScheduleInstallResult {
  const sharedServicePath = join(SYSTEMD_UNIT_DIR, 'fleet-backup@.service');
  const sharedServiceContent = sharedServiceUnit();
  const timerPath = join(SYSTEMD_UNIT_DIR, timerUnitName(app));
  const timerContent = perAppTimerUnit(app, schedule);
  const sharedServiceWrote = !existsSync(sharedServicePath);

  if (!opts.apply) {
    return { timerPath, timerContent, sharedServicePath, sharedServiceContent, sharedServiceWrote };
  }

  if (!existsSync(SYSTEMD_UNIT_DIR)) {
    mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true });
  }
  if (sharedServiceWrote) {
    writeFileSync(sharedServicePath, sharedServiceContent, { mode: 0o644 });
  }
  writeFileSync(timerPath, timerContent, { mode: 0o644 });

  const reload = execSafe('systemctl', ['daemon-reload'], { timeout: 5_000 });
  if (!reload.ok) throw new FleetError(`systemctl daemon-reload failed: ${reload.stderr}`);

  const enable = execSafe('systemctl', ['enable', '--now', timerUnitName(app)], { timeout: 5_000 });
  if (!enable.ok) throw new FleetError(`enable timer failed: ${enable.stderr}`);

  return { timerPath, timerContent, sharedServicePath, sharedServiceContent, sharedServiceWrote };
}

export function disableSchedule(app: string): void {
  execSafe('systemctl', ['disable', '--now', timerUnitName(app)], { timeout: 5_000 });
}

function sharedServiceUnit(): string {
  // the wrapper loads the rest backend url (with embedded user:pass) from
  // systemd-creds (host-key sealed at rest) and exports it as
  // FLEET_BACKUP_BASE_URL. fleet writes via the append-only rest backend.
  // legacy sftp backend still works if the wrapper / credstore entry are
  // absent.
  return `[Unit]
Description=fleet backup for %i
Documentation=fleet backup --help
After=network-online.target docker.service wg-quick@wg0.service
Wants=network-online.target wg-quick@wg0.service

[Service]
Type=oneshot
LoadCredentialEncrypted=mx-url:/etc/credstore.encrypted/mx-url
ExecStart=/usr/local/sbin/fleet-backup-wrapper %i
# big snapshots (multi-gb dumps) need headroom; default 90s would kill them.
TimeoutStartSec=4h
TimeoutStopSec=5min
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7

[Install]
WantedBy=multi-user.target
`;
}

function perAppTimerUnit(app: string, schedule: Schedule): string {
  return `[Unit]
Description=fleet backup timer for ${app}

[Timer]
OnCalendar=${onCalendarFor(schedule)}
Persistent=true
RandomizedDelaySec=10m
Unit=${serviceUnitName(app)}

[Install]
WantedBy=timers.target
`;
}
