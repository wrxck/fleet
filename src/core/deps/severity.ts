import type { Severity, DepsConfig } from './types.js';

type SeverityOverrides = DepsConfig['severityOverrides'];

export function severityFromVersionDelta(
  current: string,
  latest: string,
  overrides: SeverityOverrides,
): Severity {
  const cur = parseSemver(current);
  const lat = parseSemver(latest);

  if (!cur || !lat) return 'medium';

  if (cur.major < lat.major) return overrides.majorVersionBehind;
  if (cur.minor < lat.minor) return overrides.minorVersionBehind;
  if (cur.patch < lat.patch) return overrides.patchVersionBehind;
  return 'info';
}

export function severityFromEol(eolDate: string, warningDays: number): Severity {
  const eol = new Date(eolDate).getTime();
  const now = Date.now();
  const daysUntil = (eol - now) / (24 * 60 * 60 * 1000);

  if (daysUntil <= 0) return 'critical';
  if (daysUntil <= 30) return 'high';
  if (daysUntil <= warningDays) return 'medium';
  return 'info';
}

export function severityFromCvss(score: number): Severity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): SemVer | null {
  const clean = version.replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}
