/**
 * redaction categories and their patterns.
 *
 * every regex carries the `d` (hasIndices) flag so a capture group span can be
 * redacted instead of the whole match. that is what keeps `PASSWORD=` and
 * `postgres://user@host` readable while hiding only the value, which is the
 * difference between a usable log and a wall of placeholders.
 *
 * there is no nested unbounded quantifier anywhere in this file, and every
 * quantifier is explicitly bounded, so none of these can backtrack
 * catastrophically on a 5mb input.
 */

import {
  isCreditCard,
  isEmailish,
  isIban,
  isJwt,
  isNino,
  isRedactableIPv4,
  isRedactableIPv6,
  looksLikeCredentialBlob,
  phoneDigitCount,
} from './redaction-validate';

export const CATEGORY_NAMES = [
  'private_key',
  'jwt',
  'aws_key',
  'aws_secret',
  'provider_token',
  'auth_header',
  'uri_credentials',
  'generic_assignment',
  'iban',
  'credit_card',
  'uk_nino',
  'email',
  'phone',
  'ip',
] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];

/**
 * built-in defaults.
 *
 * phone is off: phone numbers are digit runs with optional separators, and
 * production logs are saturated with digit runs (ports, pids, byte counts,
 * durations, epoch seconds, order ids, iso dates). there is no checksum to
 * validate against, so any pattern loose enough to catch real numbers also
 * eats real telemetry. opt in per app when the app logs customer numbers.
 *
 * ip is off: operators need source and destination addresses to debug. when
 * enabled, loopback / rfc1918 / cgnat / link-local / documentation ranges are
 * still never redacted, because they identify nobody and ops depend on them.
 */
export const DEFAULT_CATEGORIES: Record<CategoryName, boolean> = {
  private_key: true,
  jwt: true,
  aws_key: true,
  aws_secret: true,
  provider_token: true,
  auth_header: true,
  uri_credentials: true,
  generic_assignment: true,
  iban: true,
  credit_card: true,
  uk_nino: true,
  email: true,
  phone: false,
  ip: false,
};

export const PEM_BEGIN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
export const PEM_END = /-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/;

const RE_PEM = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]{0,20000}?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/gd;

const RE_JWT = /\beyJ[A-Za-z0-9_-]{6,4000}\.[A-Za-z0-9_-]{4,4000}\.[A-Za-z0-9_-]{4,4000}(?![A-Za-z0-9_-])/gd;

const RE_AWS_KEY = /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/gd;

// only fires next to an aws-ish key name. a bare 40-char base64 run is far too
// common (ssh keys, digests, build hashes) to redact on shape alone.
const RE_AWS_SECRET =
  /\baws[_-]?(?:secret[_-]?access[_-]?key|secret[_-]?key|secret)\b["']?[ \t]*(?::|=)[ \t]*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gid;

// note the absence of pk_live_ / pk_test_: stripe publishable keys are public
// by design and appear in client bundles, so redacting them is pure noise.
const RE_PROVIDER = new RegExp(
  [
    'gh[pousr]_[A-Za-z0-9]{36,255}',
    'github_pat_[A-Za-z0-9_]{22,255}',
    'xox[baprse]-[A-Za-z0-9-]{10,255}',
    '[sr]k_(?:live|test)_[A-Za-z0-9]{16,255}',
    'AIza[A-Za-z0-9_-]{35}',
    'sk-ant-[A-Za-z0-9_-]{20,255}',
    'sk-proj-[A-Za-z0-9_-]{20,255}',
    'sk-[A-Za-z0-9]{32,255}',
    'glpat-[A-Za-z0-9_-]{20,255}',
    'npm_[A-Za-z0-9]{36}',
  ].map(p => `(?:${p})`).join('|'),
  'gd',
);
// word boundaries cannot be used around classes containing "-", so the edges
// are checked in code instead.
const TOKEN_EDGE = /[A-Za-z0-9_-]/;

const RE_AUTH_HEADER =
  /\b(?:Proxy-)?Authorization["']?[ \t]*(?::|=)[ \t]*["']?(?:(?:Bearer|Basic|Token|Digest|Negotiate|ApiKey)[ \t]+)?([^\s"',;]{8,4096})/gid;

const RE_BEARER = /\b(?:Bearer|Basic)[ \t]+([A-Za-z0-9\-._~+/=]{16,4096})(?![A-Za-z0-9\-._~+/=])/gd;

// keeps scheme, user and host. only the password is replaced, so the log still
// tells you which credential failed against which host.
const RE_URI_CRED = /\b[a-zA-Z][a-zA-Z0-9+.-]{1,32}:\/\/[^\s:/@]{1,256}:([^\s@/]{1,256})@/gd;

// the key name must END with a secret-implying word. that is deliberate:
// PASSWORD_FILE=/run/secrets/pw and SECRET_KEY_PATH=/etc/x stay readable,
// while MYAPP_PASSWORD=hunter2 does not.
const SECRET_KEY_SUFFIX =
  '(?:PASSWORD|PASSWD|PASSPHRASE|SECRET[_-]?ACCESS[_-]?KEY|SECRET[_-]?KEY|CLIENT[_-]?SECRET|SECRET|' +
  'ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|API[_-]?TOKEN|BEARER[_-]?TOKEN|TOKEN|' +
  'API[_-]?KEY|APIKEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIALS|CREDENTIAL|DSN)';

// a separator is mandatory, which is what lets "Invalid password supplied" and
// "token expired" through untouched.
const RE_ASSIGNMENT = new RegExp(
  `${SECRET_KEY_SUFFIX}["']?[ \\t]*(?::|=>|=(?!=))[ \\t]*` +
    `(?:"([^"\\n]{1,4096})"|'([^'\\n]{1,4096})'|([^\\s,;"'\`)\\]}&<>]{1,4096}))`,
  'gid',
);

const RE_IBAN = /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b/gd;

// the boundaries reject any adjacent word char, not just digits. found in the
// wild: mongodb logs a uuid like 1d8c2330-3387-4319-93e2-d1c10fada3d7, whose
// "2330-3387-4319-93" run is 14 digits, carries a mastercard 2-series prefix
// and passes luhn by chance. requiring non-word on both sides means a digit run
// welded to hex characters can never be read as a card.
const RE_CREDIT_CARD = /(?<![\w.-])\d(?:[ -]?\d){11,18}(?![\w.-])/gd;

const RE_NINO = /\b[ABCEGHJ-PRSTW-Z][ABCEGHJ-NPRSTW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gd;

const RE_EMAIL =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9.-])/gd;

// an explicit international prefix or a uk national trunk prefix is required.
const RE_PHONE_INTL = /(?<![\w+])\+\d{1,3}[ .-]?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]?\d{2,4}){1,4}(?![\d])/gd;
const RE_PHONE_UK = /(?<![\w+])0(?:\d[ -]?){9,10}\d(?![\d])/gd;

const RE_IPV4 = /(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gd;
const RE_IPV6 = /(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:.])/gd;

export type Push = (start: number, end: number) => void;

export interface Matcher {
  name: CategoryName;
  /** cheap literal test, skips the whole scan when the marker is absent. */
  prefilter?: (t: string) => boolean;
  run: (t: string, push: Push) => void;
}

/**
 * scan `text` with `re`, pushing the span of capture group `group` (0 for the
 * whole match). `validate` receives the value plus its position so it can
 * inspect surrounding context.
 */
function scan(
  text: string,
  re: RegExp,
  push: Push,
  group = 0,
  validate?: (value: string, start: number, text: string) => boolean,
): void {
  for (const m of text.matchAll(re)) {
    const span = m.indices?.[group];
    if (!span) continue;
    const [start, end] = span;
    if (end <= start) continue;
    if (validate && !validate(text.slice(start, end), start, text)) continue;
    push(start, end);
  }
}

/** the assignment form has three alternative value groups. take whichever hit. */
function scanAssignment(text: string, push: Push): void {
  for (const m of text.matchAll(RE_ASSIGNMENT)) {
    const span = m.indices?.[1] ?? m.indices?.[2] ?? m.indices?.[3];
    if (span) push(span[0], span[1]);
  }
}

function scanProvider(text: string, push: Push): void {
  for (const m of text.matchAll(RE_PROVIDER)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > 0 && TOKEN_EDGE.test(text[start - 1])) continue;
    if (end < text.length && TOKEN_EDGE.test(text[end])) continue;
    push(start, end);
  }
}

/**
 * order matters: an earlier matcher wins when two categories claim the exact
 * same span, so `API_KEY=ghp_...` is labelled provider_token, not the vaguer
 * generic_assignment.
 */
export const MATCHERS: Matcher[] = [
  { name: 'private_key', prefilter: t => t.includes('PRIVATE KEY'), run: (t, p) => scan(t, RE_PEM, p) },
  { name: 'jwt', prefilter: t => t.includes('eyJ'), run: (t, p) => scan(t, RE_JWT, p, 0, v => isJwt(v)) },
  {
    name: 'aws_key',
    prefilter: t => t.includes('AKIA') || t.includes('ASIA') || t.includes('ABIA') || t.includes('ACCA'),
    run: (t, p) => scan(t, RE_AWS_KEY, p),
  },
  {
    name: 'aws_secret',
    prefilter: t => t.includes('aws') || t.includes('AWS') || t.includes('Aws'),
    run: (t, p) => scan(t, RE_AWS_SECRET, p, 1),
  },
  { name: 'provider_token', run: scanProvider },
  {
    name: 'auth_header',
    run: (t, p) => {
      scan(t, RE_AUTH_HEADER, p, 1, v => looksLikeCredentialBlob(v));
      scan(t, RE_BEARER, p, 1, v => looksLikeCredentialBlob(v));
    },
  },
  {
    name: 'uri_credentials',
    prefilter: t => t.includes('://') && t.includes('@'),
    run: (t, p) => scan(t, RE_URI_CRED, p, 1),
  },
  { name: 'generic_assignment', run: scanAssignment },
  { name: 'iban', run: (t, p) => scan(t, RE_IBAN, p, 0, v => isIban(v)) },
  { name: 'credit_card', run: (t, p) => scan(t, RE_CREDIT_CARD, p, 0, v => isCreditCard(v)) },
  { name: 'uk_nino', run: (t, p) => scan(t, RE_NINO, p, 0, v => isNino(v)) },
  { name: 'email', prefilter: t => t.includes('@'), run: (t, p) => scan(t, RE_EMAIL, p, 0, isEmailish) },
  {
    name: 'phone',
    run: (t, p) => {
      scan(t, RE_PHONE_INTL, p, 0, v => phoneDigitCount(v));
      scan(t, RE_PHONE_UK, p, 0, v => phoneDigitCount(v));
    },
  },
  {
    name: 'ip',
    run: (t, p) => {
      scan(t, RE_IPV4, p, 0, isRedactableIPv4);
      if (t.includes(':')) scan(t, RE_IPV6, p, 0, v => isRedactableIPv6(v));
    },
  },
];
