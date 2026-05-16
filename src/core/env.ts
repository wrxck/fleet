import { FleetError } from './errors';

/** returns a required env var, or throws a clear error. use for secrets,
 *  keys and credential paths where a silent default would be dangerous. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new FleetError(
      `required environment variable ${name} is not set — ` +
      `it has no safe default and must be provided explicitly`,
    );
  }
  return value;
}
