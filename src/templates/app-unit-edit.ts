/**
 * like findUnitSection but returns null instead of throwing. the fleet-wide
 * patch walks every unit on the box; one malformed file must skip its own edit,
 * not abort the run for every other service.
 */
function tryFindUnitSection(content: string): { start: number; end: number } | null {
  try {
    return findUnitSection(content);
  } catch {
    return null;
  }
}

function findUnitSection(content: string): { start: number; end: number } {
  const lines = content.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '[Unit]') { start = i; continue; }
    if (start >= 0 && lines[i].startsWith('[') && lines[i].endsWith(']')) {
      end = i;
      break;
    }
  }
  if (start < 0) throw new Error('no [Unit] section found');
  if (end < 0) end = lines.length;
  return { start, end };
}

/** append lines to the end of [Unit], before any trailing blank lines. */
function appendToUnitSection(content: string, toInsert: string[]): string {
  if (toInsert.length === 0) return content;
  const lines = content.split('\n');
  const section = findUnitSection(content);
  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, ...toInsert);
  return lines.join('\n');
}

export function addAgentDependency(content: string, app: string): string {
  const lines = content.split('\n');
  const requires = `Requires=fleet-secrets-agent@${app}.service`;
  const after = `After=fleet-secrets-agent@${app}.service`;

  if (lines.includes(requires) && lines.includes(after)) return content;

  const toInsert: string[] = [];
  if (!lines.includes(requires)) toInsert.push(requires);
  if (!lines.includes(after)) toInsert.push(after);

  return appendToUnitSection(content, toInsert);
}

export function removeAgentDependency(content: string, app: string): string {
  const requires = `Requires=fleet-secrets-agent@${app}.service`;
  const after = `After=fleet-secrets-agent@${app}.service`;
  return content
    .split('\n')
    .filter(l => l !== requires && l !== after)
    .join('\n');
}

const UNSEAL_UNIT = 'fleet-unseal.service';

/**
 * make the unseal a hard dependency, not just an ordering edge. the runtime
 * secrets dir is a tmpfs and is empty after every reboot; fleet-unseal refills
 * it. its own Before= list only orders the two, so an app still starts when the
 * unseal fails and compose then has no env file to read.
 *
 * only call this when the unseal unit is installed — systemd refuses to start a
 * unit whose Requires= target is missing.
 */
export function addUnsealDependency(content: string): string {
  return addUnitDependency(content, UNSEAL_UNIT);
}

/**
 * add Requires= and After= for one unit, unless the unit is already named in
 * those directives. a malformed file with no [Unit] section is returned
 * unchanged: the fleet-wide patch walks every unit on the box, and one bad file
 * must skip its own edit rather than abort the run.
 */
export function addUnitDependency(content: string, unit: string): string {
  if (tryFindUnitSection(content) === null) return content;
  const lines = content.split('\n');
  const toInsert: string[] = [];
  if (!lines.some(l => directiveLists(l, 'Requires', unit))) toInsert.push(`Requires=${unit}`);
  if (!lines.some(l => directiveLists(l, 'After', unit))) toInsert.push(`After=${unit}`);
  return appendToUnitSection(content, toInsert);
}

/**
 * true when a systemd directive line already names the unit. the value is a
 * space-separated list, so "Requires=docker.service fleet-unseal.service"
 * counts, while "Requires=my-fleet-unseal.service" must not.
 */
function directiveLists(line: string, directive: string, unit: string): boolean {
  const prefix = `${directive}=`;
  if (!line.startsWith(prefix)) return false;
  return line.slice(prefix.length).trim().split(/\s+/).includes(unit);
}

const START_LIMIT_LINE = /^StartLimit(Burst|IntervalSec|Interval|IntervalUSec)=/;

/**
 * systemd reads the start rate limit from [Unit]. earlier versions of
 * patch-systemd wrote it into [Service], where it is silently ignored and the
 * unit falls back to the 10s/5 default. lift any existing directives out and
 * re-add them under [Unit].
 */
export function ensureStartLimitInUnit(
  content: string,
  opts: { intervalSec?: number; burst?: number } = {},
): string {
  if (!startLimitNeedsFix(content)) return content;
  const intervalSec = opts.intervalSec ?? 300;
  const burst = opts.burst ?? 5;
  const stripped = content
    .split('\n')
    .filter(l => !START_LIMIT_LINE.test(l))
    .join('\n');
  return appendToUnitSection(stripped, [
    `StartLimitIntervalSec=${intervalSec}`,
    `StartLimitBurst=${burst}`,
  ]);
}

/**
 * true when the unit has no start rate limit at all, or has one outside [Unit]
 * where systemd ignores it. a unit whose only StartLimit directives already sit
 * in [Unit] is left alone, so a deliberately tuned value survives a re-patch.
 */
export function startLimitNeedsFix(content: string): boolean {
  const section = tryFindUnitSection(content);
  if (section === null) return false;
  const lines = content.split('\n');
  let inUnit = false;
  let outsideUnit = false;
  lines.forEach((l, i) => {
    if (!START_LIMIT_LINE.test(l)) return;
    if (i > section.start && i < section.end) inUnit = true;
    else outsideUnit = true;
  });
  return outsideUnit || !inUnit;
}

const COMPOSE_DOWN_PRE = /^ExecStartPre=-?\/usr\/bin\/docker compose\b.*\bdown\b.*$/;

/**
 * drop the "compose down" that ran before every start. at boot dockerd has
 * already restarted the container from its own restart policy; tearing it down
 * before a start that can fail leaves the app with no container at all.
 * "compose up -d" reconciles a running container by itself.
 *
 * only the compose-down teardown is removed — any other ExecStartPre is kept.
 */
export function removeTeardownExecStartPre(content: string): string {
  return content
    .split('\n')
    .filter(l => !COMPOSE_DOWN_PRE.test(l))
    .join('\n');
}

export function hasTeardownExecStartPre(content: string): boolean {
  return content.split('\n').some(l => COMPOSE_DOWN_PRE.test(l));
}
