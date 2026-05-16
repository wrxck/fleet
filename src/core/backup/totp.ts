import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) throw new Error(`invalid base32 char: ${c}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** new random 20-byte secret, base32-encoded for authenticator apps. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** the 6-digit TOTP code for a base32 secret at a given epoch-ms time. */
export function totpCode(secretB32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  return hotp(base32Decode(secretB32), counter);
}

/** true if `code` is valid for the secret within a +/-1 step window. */
export function verifyTotp(secretB32: string, code: string, atMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(atMs / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (timingSafeEqualStr(hotp(secret, counter + w), code)) return true;
  }
  return false;
}

/** otpauth:// enrolment URI — paste into 1Password or an authenticator app. */
export function totpUri(secretB32: string, label: string, issuer: string): string {
  const l = encodeURIComponent(label);
  const i = encodeURIComponent(issuer);
  return `otpauth://totp/${i}:${l}?secret=${secretB32}&issuer=${i}&period=30&digits=6&algorithm=SHA1`;
}

export interface SessionPayload {
  /** epoch-ms expiry. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** signs a session payload as `<body>.<hmac>` (hmac-sha256). */
export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

/** verifies a session cookie; returns the payload or null if invalid/expired. */
export function verifySession(cookie: string, secret: string, nowMs: number = Date.now()): SessionPayload | null {
  const parts = cookie.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  if (!timingSafeEqualStr(sig, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf-8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < nowMs) return null;
  return payload;
}
