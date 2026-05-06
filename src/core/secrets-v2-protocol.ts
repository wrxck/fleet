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

export function parseRequest(buf: Buffer): ParsedRequest {
  const text = buf.toString('utf-8');
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd < 0) throw new ProtocolError('incomplete request: no header terminator');
  const headerBlock = text.slice(0, headerEnd);
  const body = text.slice(headerEnd + 4);

  const lines = headerBlock.split('\r\n');
  const first = lines[0] ?? '';
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
  if (body.length > MAX_BODY) {
    throw new ProtocolError(`body too large: ${body.length} > ${MAX_BODY}`);
  }

  return { method: method as 'GET' | 'POST', path, body };
}
