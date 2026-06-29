import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FleetError } from './errors';
import { writeJsonAtomic } from './fs-json';

const here = dirname(fileURLToPath(import.meta.url));

export interface OperatorConfig {
  username: string;
  homeDir: string;
  domain: string;
  githubOrg: string;
}

export type OperatorField = keyof OperatorConfig;
export const OPERATOR_FIELDS: readonly OperatorField[] = ['username', 'homeDir', 'domain', 'githubOrg'];
const FIELDS = OPERATOR_FIELDS;

let cache: OperatorConfig | null = null;

/** test-only: clears the memoised config. */
export function _resetOperatorCache(): void { cache = null; }

/** path the operator config is read from / written to. exported so the
 *  fleet config command can print where it lives. */
export function operatorPath(): string {
  return process.env.FLEET_OPERATOR_PATH ?? join(here, '..', '..', 'data', 'operator.json');
}

/** loads operator identity from data/operator.json (gitignored, instance-local).
 *  throws if the file is missing or incomplete — there is no safe default,
 *  and guessing another operator's identity is never correct. */
export function loadOperator(): OperatorConfig {
  if (cache) return cache;
  const path = operatorPath();
  if (!existsSync(path)) {
    throw new FleetError(
      `operator config not found at ${path} — ` +
      `copy data/operator.example.json to data/operator.json and fill it in`,
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<OperatorConfig>;
  for (const field of FIELDS) {
    if (!raw[field]) throw new FleetError(`operator config ${path} is missing field: ${field}`);
  }
  cache = raw as OperatorConfig;
  return cache;
}

/** persist the operator config to disk and clear the memoised copy so the
 *  next loadOperator() picks up the new values. atomic write via .tmp +
 *  rename so a crash mid-write never leaves a partial file behind. */
export function saveOperator(cfg: OperatorConfig): void {
  for (const field of FIELDS) {
    if (typeof cfg[field] !== 'string' || cfg[field].length === 0) {
      throw new FleetError(`operator config: ${field} must be a non-empty string`);
    }
  }
  writeJsonAtomic(operatorPath(), cfg, { mode: 0o600 });
  cache = null;
}
