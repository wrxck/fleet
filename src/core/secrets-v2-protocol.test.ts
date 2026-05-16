import { describe, it, expect } from 'vitest';

import { parseRequest, writeResponse, ProtocolError } from './secrets-v2-protocol.js';

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

  it('rejects path with query string (no query support)', () => {
    expect(() => parseRequest(Buffer.from('GET /secrets?x=1 HTTP/1.1\r\n\r\n'))).toThrow(/query string not supported/i);
  });

  it('rejects multi-byte body exceeding MAX_BODY in bytes', () => {
    // 513 copies of é (u+00e9) = 513 string chars but 1026 bytes (utf-8 2 bytes each)
    const big = 'é'.repeat(513);
    const buf = Buffer.from(`POST /refresh HTTP/1.1\r\nContent-Length: ${Buffer.byteLength(big)}\r\n\r\n${big}`);
    expect(() => parseRequest(buf)).toThrow(/body too large/i);
  });
});

describe('writeResponse', () => {
  it('writes a 200 with JSON body', () => {
    const out = writeResponse(200, { foo: 'bar' });
    const text = out.toString('utf-8');
    expect(text).toContain('HTTP/1.1 200 OK');
    expect(text).toContain('Content-Type: application/json');
    expect(text).toContain('Content-Length: 13');
    expect(text).toContain('\r\n\r\n{"foo":"bar"}');
  });

  it('writes a 404', () => {
    const out = writeResponse(404, { error: 'not_found' });
    expect(out.toString('utf-8')).toContain('HTTP/1.1 404 Not Found');
  });

  it('writes a 429', () => {
    const out = writeResponse(429, { error: 'rate_limited' });
    expect(out.toString('utf-8')).toContain('HTTP/1.1 429 Too Many Requests');
  });

  it('writes a 500', () => {
    const out = writeResponse(500, { error: 'internal' });
    expect(out.toString('utf-8')).toContain('HTTP/1.1 500 Internal Server Error');
  });
});
