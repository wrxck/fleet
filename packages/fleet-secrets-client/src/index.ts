import { fetchSecrets } from './client.js';

export { FleetSecretsError } from './errors.js';

export interface LoadOptions {
  socketPath?: string;
  injectIntoEnv?: boolean;
}

export interface LoadedSecrets<T extends Record<string, string> = Record<string, string>> {
  readonly values: T;
  refresh(): Promise<void>;
}

export async function loadSecrets<T extends Record<string, string> = Record<string, string>>(
  opts: LoadOptions = {},
): Promise<LoadedSecrets<T>> {
  const path = opts.socketPath ?? process.env.FLEET_SECRETS_SOCKET ?? '/run/fleet.sock';
  let inner = (await fetchSecrets(path)) as T;
  if (opts.injectIntoEnv) Object.assign(process.env, inner);
  return {
    get values() { return inner; },
    refresh: async () => {
      const fresh = (await fetchSecrets(path)) as T;
      inner = fresh;
      if (opts.injectIntoEnv) Object.assign(process.env, fresh);
    },
  } as LoadedSecrets<T>;
}
