import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { execSafe } from '../exec';
import { FleetError } from '../errors';
import type { GreenlightReport } from './types';

export const GREENLIGHT_INSTALL_HINT = [
  'greenlight binary not found. Install it with one of:',
  '  go install github.com/RevylAI/greenlight/cmd/greenlight@latest',
  '  brew install revylai/tap/greenlight',
  'Then re-run, or point GREENLIGHT_BIN at an absolute path.',
].join('\n');

// locate the greenlight binary. honours $GREENLIGHT_BIN first, then anything
// on $PATH, then the usual `go install` and homebrew destinations. returns the
// command/path execSafe should invoke, or null when nothing usable is found.
export function findGreenlight(): string | null {
  const override = process.env.GREENLIGHT_BIN;
  if (override) return existsSync(override) ? override : null;

  if (execSafe('greenlight', ['--help'], { timeout: 10_000 }).ok) {
    return 'greenlight';
  }

  const candidates: string[] = [];
  if (process.env.GOBIN) candidates.push(join(process.env.GOBIN, 'greenlight'));
  const gopath = execSafe('go', ['env', 'GOPATH'], { timeout: 10_000 });
  if (gopath.ok && gopath.stdout) {
    candidates.push(join(gopath.stdout.split('\n')[0].trim(), 'bin', 'greenlight'));
  }
  candidates.push(
    join(homedir(), 'go', 'bin', 'greenlight'),
    '/opt/homebrew/bin/greenlight',
    '/usr/local/bin/greenlight',
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// resolve the binary or fail loudly with install guidance.
export function requireGreenlight(): string {
  const bin = findGreenlight();
  if (!bin) throw new FleetError(GREENLIGHT_INSTALL_HINT);
  return bin;
}

// best-effort version string for diagnostics; null if it can't be read.
export function greenlightVersion(bin: string): string | null {
  const res = execSafe(bin, ['version'], { timeout: 10_000 });
  if (res.ok && res.stdout) return res.stdout.split('\n')[0].trim();
  return null;
}

export interface PreflightOptions {
  ipaPath?: string;
  timeoutMs?: number;
}

// run `greenlight preflight <project> --format json` and parse the report.
// greenlight exits 0 for any successful scan regardless of how many issues it
// finds — a non-zero exit means the scan itself failed (bad path, binary
// error), so that is the only case treated as an error here.
export function runPreflight(
  projectPath: string,
  opts: PreflightOptions = {},
  bin: string = requireGreenlight(),
): GreenlightReport {
  const args = ['preflight', projectPath, '--format', 'json'];
  if (opts.ipaPath) args.push('--ipa', opts.ipaPath);

  const res = execSafe(bin, args, { timeout: opts.timeoutMs ?? 120_000 });
  if (!res.ok) {
    throw new FleetError(
      `greenlight preflight failed: ${res.stderr || res.stdout || 'unknown error'}`,
    );
  }
  // greenlight prints a human banner (project path, scanner list) to stdout
  // before the json document even under --format json, so slice from the
  // first brace. the banner is plain text and never contains one.
  const jsonStart = res.stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new FleetError(
      `greenlight produced no json report:\n${res.stdout.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(res.stdout.slice(jsonStart)) as GreenlightReport;
  } catch {
    throw new FleetError(
      `greenlight returned output that is not valid json:\n${res.stdout.slice(0, 500)}`,
    );
  }
}

// passthrough to `greenlight guidelines <args>` (list | show <section> |
// search <term>) — returns the rendered text for the caller to print.
export function runGuidelines(args: string[], bin: string = requireGreenlight()): string {
  const res = execSafe(bin, ['guidelines', ...args], { timeout: 15_000 });
  return (res.stdout || res.stderr).trim();
}
