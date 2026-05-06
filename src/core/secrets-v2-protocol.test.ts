import { describe, it, expect } from 'vitest';

import { parseRequest, ProtocolError } from './secrets-v2-protocol.js';

describe('parseRequest', () => {
  it('parses GET /secrets', () => {
    const req = parseRequest(Buffer.from('GET /secrets HTTP/1.1\r\nHost: localhost\r\n\r\n'));
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/secrets');
    expect(req.body).toBe('');
  });

  it('parses GET /secrets/STRIPE_KEY', () => {
    const req = parseRequest(Buffer.from('GET /secrets/STRIPE_KEY HTTP/1.1\r\n\r\n'));
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/secrets/STRIPE_KEY');
  });

  it('parses POST /refresh with empty body', () => {
    const req = parseRequest(Buffer.from('POST /refresh HTTP/1.1\r\nContent-Length: 0\r\n\r\n'));
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/refresh');
    expect(req.body).toBe('');
  });

  it('rejects malformed first line', () => {
    expect(() => parseRequest(Buffer.from('GARBAGE\r\n\r\n'))).toThrow(ProtocolError);
  });

  it('rejects body larger than 1KB', () => {
    const big = 'x'.repeat(2000);
    const buf = Buffer.from(`POST /refresh HTTP/1.1\r\nContent-Length: ${big.length}\r\n\r\n${big}`);
    expect(() => parseRequest(buf)).toThrow(/body too large/i);
  });

  it('rejects unknown method', () => {
    expect(() => parseRequest(Buffer.from('PATCH /secrets HTTP/1.1\r\n\r\n'))).toThrow(ProtocolError);
  });

  it('strips path query string (no query support)', () => {
    expect(() => parseRequest(Buffer.from('GET /secrets?x=1 HTTP/1.1\r\n\r\n'))).toThrow(/query string not supported/i);
  });
});
