import { readFileSync, existsSync } from 'node:fs';

import { FleetError } from '../errors';
import type { AscCredentials } from './types';

// resolve app store connect api credentials from an environment map. the
// private key is supplied either inline-base64 (ASC_API_KEY_B64) or as a path
// to a .p8 file (ASC_API_KEY_PATH) — base64 is preferred so the key lives in
// the fleet secrets vault rather than as a loose file on disk.
export function resolveAscCredentials(env: NodeJS.ProcessEnv): AscCredentials {
  const keyId = env.ASC_API_KEY_ID;
  const issuerId = env.ASC_API_KEY_ISSUER_ID;
  if (!keyId || !issuerId) {
    throw new FleetError(
      'App Store Connect credentials missing — set ASC_API_KEY_ID and ASC_API_KEY_ISSUER_ID.',
    );
  }

  let privateKey: string | undefined;
  if (env.ASC_API_KEY_B64) {
    privateKey = Buffer.from(env.ASC_API_KEY_B64, 'base64').toString('utf-8');
  } else if (env.ASC_API_KEY_PATH && existsSync(env.ASC_API_KEY_PATH)) {
    privateKey = readFileSync(env.ASC_API_KEY_PATH, 'utf-8');
  }
  if (!privateKey || !privateKey.includes('PRIVATE KEY')) {
    throw new FleetError(
      'App Store Connect private key missing — set ASC_API_KEY_B64 (base64 of the .p8) ' +
      'or ASC_API_KEY_PATH (path to the .p8 file).',
    );
  }

  return { keyId, issuerId, privateKey };
}

// true when full app store connect credentials are present in `env`.
export function hasAscCredentials(env: NodeJS.ProcessEnv): boolean {
  try {
    resolveAscCredentials(env);
    return true;
  } catch {
    return false;
  }
}
