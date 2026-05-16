# @matthesketh/fleet-secrets-client

Client library for [fleet](https://github.com/wrxck/fleet) `fleet-secrets-agent` v2. Fetches secrets from a Unix socket on app startup.

## Install

```
npm install @matthesketh/fleet-secrets-client
```

## Usage

```ts
import { loadSecrets } from '@matthesketh/fleet-secrets-client';

const secrets = await loadSecrets();
console.log(secrets.values.STRIPE_KEY);

// later, after rotation
await secrets.refresh();
```

### Inject into process.env

For backward compatibility with code that reads `process.env.X`:

```ts
await loadSecrets({ injectIntoEnv: true });
// process.env.STRIPE_KEY is now set
```

Note: this loses the security benefit of v2 (env vars leak via `/proc/<pid>/environ`). Use only during migration; non-injection mode is preferred.

## Configuration

- Socket path defaults to `process.env.FLEET_SECRETS_SOCKET` then `/run/fleet.sock`.
- Pass `{ socketPath }` to override.

## License

MIT
