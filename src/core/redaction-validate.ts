/**
 * structural validators used by the redaction patterns.
 *
 * every one of these exists to kill a specific false positive. a pattern that
 * cannot be structurally validated (luhn, mod-97, base64-decode, octet range)
 * must instead be anchored on a vendor literal or a secret-implying key name.
 * high entropy alone is never enough: commit shas, uuids, image digests and
 * build ids all look exactly like secrets.
 */

/** luhn (mod-10) checksum over a digit string. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * card brand iin screen. this is what keeps 13-digit epoch millis
 * (1754870400000, prefix "17") and other luhn-lucky numeric ids out: no card
 * network issues under those prefixes. the deliberate cost is that an
 * unbranded but luhn-valid 16-digit number passes through unredacted.
 */
function looksLikeCardIIN(d: string): boolean {
  if (/^4/.test(d)) return true;
  if (/^5[1-5]/.test(d)) return true;
  if (/^2[2-7]/.test(d)) return true;
  if (/^3[47]/.test(d)) return true;
  if (/^3(?:0[0-5]|[689])/.test(d)) return true;
  if (/^35(?:2[89]|[3-8])/.test(d)) return true;
  if (/^6(?:011|5|4[4-9]|2)/.test(d)) return true;
  return false;
}

export function isCreditCard(raw: string): boolean {
  // separators must be consistent. "4111 1111-1111 1111" is not a card, it is
  // two unrelated numbers that happen to be adjacent in one log line.
  const seps = new Set(raw.match(/[ -]/g) ?? []);
  if (seps.size > 1) return false;
  const d = raw.replace(/[ -]/g, '');
  if (d.length < 13 || d.length > 19) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  if (!looksLikeCardIIN(d)) return false;
  return luhnValid(d);
}

/** prefixes the uk ni numbering scheme never issues. */
const NINO_BAD_PREFIXES = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);

export function isNino(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[ABCEGHJ-PRSTW-Z][ABCEGHJ-NPRSTW-Z]\d{6}[A-D]$/.test(s)) return false;
  return !NINO_BAD_PREFIXES.has(s.slice(0, 2));
}

/** iso 13616 iban registry lengths. unknown country codes are rejected. */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27,
  MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24,
  SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29,
  VA: 22, VG: 24, XK: 20,
};

export function isIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  const expected = IBAN_LENGTHS[s.slice(0, 2)];
  if (!expected || s.length !== expected) return false;
  // mod-97: rotate the first four chars to the end, map letters to 10..35,
  // remainder must be exactly 1.
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const c = rearranged.charCodeAt(i);
    if (c >= 48 && c <= 57) rem = (rem * 10 + (c - 48)) % 97;
    else if (c >= 65 && c <= 90) rem = (rem * 100 + (c - 55)) % 97;
    else return false;
  }
  return rem === 1;
}

/**
 * jwt check: decode the first segment and require a json object carrying an
 * `alg` member. pattern matching alone would hit arbitrary dotted strings.
 */
export function isJwt(token: string): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    if (!json.startsWith('{')) return false;
    const obj = JSON.parse(json) as unknown;
    return !!obj && typeof obj === 'object' && typeof (obj as { alg?: unknown }).alg === 'string';
  } catch {
    return false;
  }
}

/**
 * a bare word run is prose or an auth scheme name, not a credential blob.
 * real bearer/basic credentials are long and carry digits or base64 symbols,
 * so this keeps `Bearer token missing` and `Authorization: Negotiate` intact.
 */
export function looksLikeCredentialBlob(v: string): boolean {
  if (/^[a-z]+$/.test(v)) return false;
  if (/^[A-Z]+$/.test(v)) return false;
  if (v.length < 16 && /^[A-Za-z]+$/.test(v)) return false;
  return true;
}

function ipv4Octets(v: string): number[] | null {
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p[0] === '0') return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** ranges operators depend on and which identify nobody. never redacted. */
function isOperationalIPv4(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

export function isRedactableIPv4(v: string, start: number, text: string): boolean {
  const o = ipv4Octets(v);
  if (!o) return false;
  if (isOperationalIPv4(o)) return false;
  // "Chrome/120.0.0.0" is a version, not an address: a slash preceded by a
  // letter. "https://93.184.216.34" (slash preceded by slash) still counts.
  if (start > 1 && text[start - 1] === '/' && /[A-Za-z]/.test(text[start - 2])) return false;
  return true;
}

export function isRedactableIPv6(v: string): boolean {
  const lower = v.toLowerCase();
  const dbl = lower.indexOf('::');
  const groups = lower.split(':');
  if (dbl >= 0) {
    if (lower.indexOf('::', dbl + 1) >= 0) return false;
  } else if (groups.length !== 8) {
    // without a "::" an address must be fully expanded. this is what stops
    // "12:34:56" (a timestamp) reading as an address.
    return false;
  }
  if (groups.length > 8) return false;
  for (const g of groups) {
    if (g === '') continue;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return false;
  }
  if (lower === '::' || lower === '::1') return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (/^f[cd]/.test(lower)) return false;
  if (/^ff/.test(lower)) return false;
  return true;
}

/**
 * domain-final labels far more likely to be a file extension than a tld in a
 * server log. stops `logo@2x.png` reading as an email address.
 */
const NON_TLD_SUFFIXES = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'scss', 'html', 'htm',
  'md', 'txt', 'log', 'yml', 'yaml', 'lock', 'map', 'xml', 'csv', 'pdf',
  'zip', 'gz', 'tar', 'sql', 'env', 'conf', 'ini', 'toml',
]);

/**
 * `postgres://appuser:hunter2@db.internal` is not an email address, it is a
 * password followed by a host. left alone, the email pattern would claim the
 * wider `hunter2@db.internal` span and hide the host that makes the log
 * useful, so userinfo passwords are rejected here and left to uri_credentials.
 */
function precededByUriUserinfo(text: string, start: number): boolean {
  if (start === 0 || text[start - 1] !== ':') return false;
  const seg = text.slice(Math.max(0, start - 512), start - 1);
  const idx = seg.lastIndexOf('://');
  if (idx < 0) return false;
  return !/[\s@]/.test(seg.slice(idx + 3));
}

export function isEmailish(value: string, start: number, text: string): boolean {
  if (precededByUriUserinfo(text, start)) return false;
  const domain = value.slice(value.lastIndexOf('@') + 1);
  const tld = domain.slice(domain.lastIndexOf('.') + 1).toLowerCase();
  return !NON_TLD_SUFFIXES.has(tld);
}

export function phoneDigitCount(v: string): boolean {
  const d = v.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15;
}
