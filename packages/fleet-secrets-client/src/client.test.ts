import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fetchSecrets } from './client.js';
import { FleetSecretsError } from './errors.js';

function tmpSock(): string {
  return join(tmpdir(), `fleet-test-${randomBytes(6).toString('hex')}.sock`);
}

function makeServer(response: string) {
  const sockPath = tmpSock();
  const server = createServer((conn) => {
    conn.on('data', () => {
      conn.write(response);
      conn.end();
    });
  });
  return { sockPath, server };
}

describe('fetchSecrets', () => {
  let sockPath: string;
  let server: ReturnType<typeof createServer>;

  afterEach((ctx) => {
    void ctx;
    if (server) {
      server.close();
    }
  });

  it('happy path: resolves with parsed secrets map', async () => {
    const body = JSON.stringify({ FOO: 'bar', STRIPE_KEY: 'sk_test_abc' });
    const response = `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    ({ sockPath, server } = makeServer(response));
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    const result = await fetchSecrets(sockPath);
    expect(result).toEqual({ FOO: 'bar', STRIPE_KEY: 'sk_test_abc' });
  });

  it('non-200 status: rejects with http_500 code', async () => {
    const body = 'internal error';
    const response = `HTTP/1.1 500 Internal Server Error\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    ({ sockPath, server } = makeServer(response));
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    await expect(fetchSecrets(sockPath)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(FleetSecretsError);
      expect((err as FleetSecretsError).code).toBe('http_500');
      return true;
    });
  });

  it('connection refused: rejects with socket_error code', async () => {
    const nonExistentPath = tmpSock();
    await expect(fetchSecrets(nonExistentPath)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(FleetSecretsError);
      expect((err as FleetSecretsError).code).toBe('socket_error');
      return true;
    });
  });

  it('timeout: rejects with timeout code when server hangs', async () => {
    sockPath = tmpSock();
    server = createServer((_conn) => {
      // intentionally never respond to trigger timeout
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    // use env var override to set a short timeout (50ms) to avoid flakiness
    const original = process.env.FLEET_SECRETS_TIMEOUT_MS;
    process.env.FLEET_SECRETS_TIMEOUT_MS = '50';
    try {
      await expect(fetchSecrets(sockPath)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(FleetSecretsError);
        expect((err as FleetSecretsError).code).toBe('timeout');
        return true;
      });
    } finally {
      if (original === undefined) {
        delete process.env.FLEET_SECRETS_TIMEOUT_MS;
      } else {
        process.env.FLEET_SECRETS_TIMEOUT_MS = original;
      }
    }
  });

  it('non-object response: rejects with malformed code', async () => {
    const body = 'null';
    const response = `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    ({ sockPath, server } = makeServer(response));
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    await expect(fetchSecrets(sockPath)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(FleetSecretsError);
      expect((err as FleetSecretsError).code).toBe('malformed');
      return true;
    });
  });
});
