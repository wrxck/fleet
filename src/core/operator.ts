import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FleetError } from './errors';

const here = dirname(fileURLToPath(import.meta.url));

export interface OperatorConfig {
  username: string;
  homeDir: string;
  domain: string;
  githubOrg: string;
}

const FIELDS = ['username', 'homeDir', 'domain', 'githubOrg'] as const;

let cache: OperatorConfig | null = null;

/** test-only: clears the memoised config. */
export function _resetOperatorCache(): void { cache = null; }

function operatorPath(): string {
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
