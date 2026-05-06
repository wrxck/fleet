export class ProtocolError extends Error {
  constructor(message: string) { super(message); this.name = 'ProtocolError'; }
}

export interface ParsedRequest {
  method: 'GET' | 'POST';
  path: string;
  body: string;
}

const MAX_BODY = 1024;
const ALLOWED_METHODS = new Set(['GET', 'POST']);

/**
 * Parse a single HTTP/1.1 request from a Unix-socket read buffer.
 *
 * Callers must enforce an upper bound on `buf` size BEFORE invoking. This
 * function will scan the full buffer for the header terminator (`\r\n\r\n`)
 * and so does O(n) work on n bytes — feeding it arbitrarily large input is
 * a DoS vector. The socket server should cap reads at a small multiple of
 * MAX_BODY (e.g., 8 KiB) and call this only on bounded buffers.
 */
export function parseRequest(buf: Buffer): ParsedRequest {
  const TERM = Buffer.from('\r\n\r\n');
  const headerEnd = buf.indexOf(TERM);
  if (headerEnd < 0) throw new ProtocolError('incomplete request: no header terminator');

  const bodyStart = headerEnd + TERM.length;
  const bodyBytes = buf.length - bodyStart;
  if (bodyBytes > MAX_BODY) {
    throw new ProtocolError(`body too large: ${bodyBytes} > ${MAX_BODY}`);
  }

  const headerBlock = buf.slice(0, headerEnd).toString('utf-8');
  const body = buf.slice(bodyStart).toString('utf-8');

  const first = headerBlock.split('\r\n')[0] ?? '';
  const m = first.match(/^([A-Z]+) (\S+) HTTP\/1\.1$/);
  if (!m) throw new ProtocolError(`malformed request line: ${first}`);

  const method = m[1];
  const path = m[2];

  if (!ALLOWED_METHODS.has(method)) {
    throw new ProtocolError(`method not allowed: ${method}`);
  }
  if (path.includes('?')) {
    throw new ProtocolError('query string not supported');
  }

  return { method: method as 'GET' | 'POST', path, body };
}
