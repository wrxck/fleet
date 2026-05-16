import { createConnection } from 'node:net';

import { FleetSecretsError } from './errors.js';

export async function fetchSecrets(socketPath: string): Promise<Record<string, string>> {
  const timeoutMs = Number(process.env.FLEET_SECRETS_TIMEOUT_MS) || 5000;
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    const chunks: Buffer[] = [];

    const cleanup = () => {
      try { sock.destroy(); } catch { /* ignore */ }
    };

    sock.setTimeout(timeoutMs, () => {
      cleanup();
      reject(new FleetSecretsError('agent fetch timed out', 'timeout'));
    });

    sock.on('connect', () => {
      sock.write('GET /secrets HTTP/1.1\r\nHost: localhost\r\n\r\n');
    });

    sock.on('data', (c) => chunks.push(c));

    sock.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        const m = text.match(/^HTTP\/1\.1 (\d+)/);
        if (!m) {
          reject(new FleetSecretsError(`malformed response from agent: ${text.slice(0, 80)}`, 'malformed'));
          return;
        }
        const status = parseInt(m[1], 10);
        const bodyStart = text.indexOf('\r\n\r\n');
        const body = bodyStart >= 0 ? text.slice(bodyStart + 4) : '';
        if (status !== 200) {
          reject(new FleetSecretsError(`agent returned ${status}: ${body}`, 'http_' + status));
          return;
        }
        const parsed = JSON.parse(body);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new FleetSecretsError('agent response is not an object', 'malformed'));
          return;
        }
        resolve(parsed as Record<string, string>);
      } catch (err) {
        reject(new FleetSecretsError(`failed to parse agent response: ${(err as Error).message}`, 'parse_error'));
      }
    });

    sock.on('error', (err) => {
      cleanup();
      reject(new FleetSecretsError(`socket error: ${err.message}`, 'socket_error'));
    });
  });
}
