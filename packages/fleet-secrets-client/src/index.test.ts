import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FleetSecretsError, loadSecrets } from './index.js';

function tmpSock(): string {
  return join(tmpdir(), `fleet-idx-test-${randomBytes(6).toString('hex')}.sock`);
}

function makeServer(body: Record<string, string>, status = 200): { sockPath: string; server: Server } {
  const sockPath = tmpSock();
  const json = JSON.stringify(body);
  const response = `HTTP/1.1 ${status} OK\r\nContent-Length: ${json.length}\r\n\r\n${json}`;
  const server = createServer((conn) => {
    conn.on('data', () => {
      conn.write(response);
      conn.end();
    });
  });
  return { sockPath, server };
}

describe('loadSecrets', () => {
  let server: Server | undefined;

  afterEach(() => {
    if (server) {
      server.close();
      server = undefined;
    }
  });

  it('returns object with values and refresh function', async () => {
    const { sockPath, server: s } = makeServer({ KEY: 'value' });
    server = s;
    await new Promise<void>((resolve) => server!.listen(sockPath, resolve));

    const secrets = await loadSecrets({ socketPath: sockPath });
    expect(secrets.values).toEqual({ KEY: 'value' });
    expect(typeof secrets.refresh).toBe('function');
  });

  it('uses explicit socketPath option', async () => {
    const { sockPath, server: s } = makeServer({ EXPLICIT: 'yes' });
    server = s;
    await new Promise<void>((resolve) => server!.listen(sockPath, resolve));

    const secrets = await loadSecrets({ socketPath: sockPath });
    expect(secrets.values.EXPLICIT).toBe('yes');
  });

  it('injectIntoEnv puts secrets into process.env', async () => {
    const { sockPath, server: s } = makeServer({ INJECTED_KEY: 'injected_value' });
    server = s;
    await new Promise<void>((resolve) => server!.listen(sockPath, resolve));

    delete process.env.INJECTED_KEY;
    try {
      await loadSecrets({ socketPath: sockPath, injectIntoEnv: true });
      expect(process.env.INJECTED_KEY).toBe('injected_value');
    } finally {
      delete process.env.INJECTED_KEY;
    }
  });

  it('refresh() re-fetches and updates values via getter', async () => {
    const sockPath = tmpSock();
    let callCount = 0;
    const responses = [
      { ROUND: 'first' },
      { ROUND: 'second' },
    ];
    server = createServer((conn) => {
      conn.on('data', () => {
        const body = JSON.stringify(responses[callCount] ?? responses[responses.length - 1]);
        callCount++;
        conn.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        conn.end();
      });
    });
    await new Promise<void>((resolve) => server!.listen(sockPath, resolve));

    const secrets = await loadSecrets({ socketPath: sockPath });
    expect(secrets.values.ROUND).toBe('first');

    await secrets.refresh();
    expect(secrets.values.ROUND).toBe('second');
  });

  it('rejects with FleetSecretsError if socket missing', async () => {
    const missingPath = tmpSock();
    await expect(loadSecrets({ socketPath: missingPath })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(FleetSecretsError);
      expect((err as FleetSecretsError).code).toBe('socket_error');
      return true;
    });
  });
});
