import { describe, it, expect } from 'vitest';

import { redactText, redactLine, resolveRedaction, createLineRedactor } from './redaction';

/**
 * provider fixtures are assembled at runtime from parts. written out as whole
 * literals they trip github push protection, which scans source for exactly
 * the shapes this suite exists to exercise. the redactor still sees the
 * complete, correctly shaped token at test time.
 */
const tok = (...parts: string[]): string => parts.join('');
const STRIPE_SECRET = tok('sk_', 'live_', 'FAKEKEYFORTESTSONLY0000');

/** fingerprints off keeps assertions readable; a dedicated block covers them. */
const plain = resolveRedaction({ fingerprint: false });
const withIp = resolveRedaction({ fingerprint: false, categories: { ip: true } });
const withPhone = resolveRedaction({ fingerprint: false, categories: { phone: true } });

function unchanged(input: string, cfg = plain): void {
  expect(redactText(input, cfg).text).toBe(input);
}

// the negative suite comes first on purpose. over-redaction destroys the
// debuggability of production logs, so anything in here regressing is a worse
// bug than a missed secret.
describe('no false positives on things that merely look like secrets', () => {
  it('leaves git commit shas alone (7, 8 and 40 hex)', () => {
    unchanged('deploying a1b2c3d');
    unchanged('deploying a1b2c3d4');
    unchanged('deploying 1234567890abcdef1234567890abcdef12345678');
    unchanged('git log --oneline: deadbeef fix(logs): cap output at 200KB');
  });

  it('leaves uuids alone', () => {
    unchanged('request_id=550e8400-e29b-41d4-a716-446655440000 completed');
    unchanged('correlation 3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  it('leaves a uuid whose digit run passes luhn alone (found in mongodb logs)', () => {
    // "2330-3387-4319-93" inside this uuid is 14 digits with a mastercard
    // 2-series prefix and it passes luhn by chance. it is still a uuid.
    unchanged('{"uuid":{"$uuid":"1d8c2330-3387-4319-93e2-d1c10fada3d7"}}');
    unchanged('conn 1d8c2330-3387-4319-93e2-d1c10fada3d7 accepted');
  });

  it('leaves card-shaped digit runs welded to hex characters alone', () => {
    unchanged('trace ab4111111111111111cd');
    unchanged('hash 4111111111111111deadbeef');
  });

  it('leaves docker image digests and short container ids alone', () => {
    unchanged('pulled sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    unchanged('container 3f4a9b2c1d8e exited with code 0');
  });

  it('leaves semantic versions alone', () => {
    unchanged('fleet 1.16.0 starting');
    unchanged('upgrading to v2.0.0-beta.1');
    unchanged('node v20.17.0, npm 10.8.2');
  });

  it('leaves timestamps, epoch millis and durations alone', () => {
    unchanged('2026-08-09T12:34:56.789Z request finished in 1234ms');
    unchanged('now=1754870400000 uptime=86400s');
    unchanged('window 2026-08-09 2026-08-10 inclusive');
  });

  it('leaves file paths and credential-free urls alone', () => {
    unchanged('reading /run/fleet-secrets/poolside/.env');
    unchanged('GET https://api.example.com/v1/users?page=2 200');
    unchanged('mounted /var/lib/docker/containers/abc/def.log');
  });

  it('leaves ports, pids, byte counts, percentages and hex colours alone', () => {
    unchanged('listening on 3007, pid 48213, rss 104857600 bytes, cpu 87%');
    unchanged('accent #ff8800 background #FFF border #1a2b3c');
  });

  it('leaves stripe publishable keys alone but redacts secret keys', () => {
    unchanged('boot pk_test_51H8fghIjKlMnOpQrStUvWxYz');
    unchanged('boot pk_live_51H8fghIjKlMnOpQrStUvWxYz');
    expect(redactText(`boot ${STRIPE_SECRET}`, plain).text)
      .toBe('boot [REDACTED:provider_token]');
    expect(redactText(`boot ${tok('rk_', 'live_', '51H8fghIjKlMnOpQrStUvWxYz')}`, plain).text)
      .toBe('boot [REDACTED:provider_token]');
  });

  it('leaves ssh public keys alone', () => {
    unchanged(
      'authorized_keys += ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDZ1234567890abcdefghij' +
      'klmnopqrstuvwxyzABCDEFGHIJKLMNOP deploy@buildhost',
    );
    unchanged('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ1234567890abcdefghijklmnopqrstuvwxyzAB');
  });

  it('leaves bare secret-ish words in prose alone (no value follows)', () => {
    unchanged('Invalid password supplied');
    unchanged('token expired, please re-authenticate');
    unchanged('secret mismatch for tenant acme');
    unchanged('the api key rotation job finished');
    unchanged('Basic auth rejected');
    unchanged('Bearer token missing from request');
    unchanged('Bearer authentication rejected');
    unchanged('Authorization: Negotiate');
  });

  it('leaves short base64 and image data uris alone', () => {
    unchanged('decoded aGVsbG8= as hello');
    unchanged(
      'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA' +
      'DUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="',
    );
  });

  it('leaves retina asset filenames alone (not email addresses)', () => {
    unchanged('GET /assets/logo@2x.png 200');
    unchanged('bundling icon@3x.webp');
  });

  it('leaves random 16-digit numbers alone (luhn + iin screen)', () => {
    unchanged('order 1234567890123456 completed');
    unchanged('invoice 9999999999999999 settled');
    unchanged('batch 1754870400000 flushed');
  });

  it('leaves keys whose name does not END in a secret word alone', () => {
    unchanged('PASSWORD_FILE=/run/secrets/db_password');
    unchanged('SECRET_KEY_PATH=/etc/app/key.pem');
    unchanged('TOKEN_TTL_SECONDS=3600');
    unchanged('tokenizer=fast');
    unchanged('npm_config_registry=https://registry.npmjs.org/');
  });

  it('leaves private and loopback addresses alone even with ip redaction on', () => {
    unchanged('upstream 127.0.0.1:5432 healthy', withIp);
    unchanged('peer 10.1.2.3 and 192.168.0.5 and 172.16.4.4', withIp);
    unchanged('bound ::1 and fe80::1 and fd00::abcd', withIp);
    unchanged('cgnat 100.64.0.1 docs 203.0.113.9 multicast 224.0.0.1', withIp);
    unchanged('bind 0.0.0.0:3007', withIp);
  });

  it('leaves user-agent version strings alone even with ip redaction on', () => {
    unchanged(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36',
      withIp,
    );
    unchanged('curl/8.5.0 libcurl/8.5.0', withIp);
  });

  it('leaves clock times alone even with ip redaction on (not ipv6)', () => {
    unchanged('elapsed 12:34:56 since start', withIp);
    unchanged('cron 05:30:00 fired', withIp);
  });

  it('leaves version-shaped digit runs alone even with phone redaction on', () => {
    unchanged('build 2026080912 finished', withPhone);
    unchanged('rss 104857600 bytes', withPhone);
  });
});

describe('secret categories', () => {
  it('redacts aws access key ids', () => {
    expect(redactText('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE', plain).text)
      .toBe('AWS_ACCESS_KEY_ID=[REDACTED:aws_key]');
    expect(redactText('sts issued ASIAY34FZKBOKMUTVV7A now', plain).text)
      .toBe('sts issued [REDACTED:aws_key] now');
  });

  it('redacts an aws secret only when an aws key name is adjacent', () => {
    expect(redactText('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', plain).text)
      .toBe('aws_secret_access_key = [REDACTED:aws_secret]');
    // the same 40-char blob with no aws context is left alone on purpose.
    unchanged('digest wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });

  it('redacts jwts only when the header decodes to json with an alg', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0' +
      '.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactText(`auth ok ${jwt}`, plain).text).toBe('auth ok [REDACTED:jwt]');
    // dotted identifiers that are not jwts must survive.
    unchanged('module com.example.service.Handler loaded');
    unchanged('file a1b2c3d4.e5f6g7h8.i9j0k1l2 written');
  });

  it('redacts the whole pem private key block', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAy8Dbv8prpJ/0kKhlGeJYozo2t60EG8L0561g13R29LvMR5hy',
      'vGZlGJpmn65+A4xHXInJYiPuKzrKUnApeLZ+vw1HocOAZtWK0z3r26oZzDMjlbWR',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(redactText(`loaded key:\n${pem}\ndone`, plain).text)
      .toBe('loaded key:\n[REDACTED:private_key]\ndone');
  });

  it('redacts openssh and ec private key blocks too', () => {
    for (const label of ['OPENSSH', 'EC', 'ENCRYPTED']) {
      const pem = `-----BEGIN ${label} PRIVATE KEY-----\nAAAA\n-----END ${label} PRIVATE KEY-----`;
      expect(redactText(pem, plain).text).toBe('[REDACTED:private_key]');
    }
    expect(redactText('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', plain).text)
      .toBe('[REDACTED:private_key]');
  });

  it('redacts authorization header values, keeping the scheme', () => {
    expect(redactText('GET /x Authorization: Bearer abc123DEF456ghi789JKL012', plain).text)
      .toBe('GET /x Authorization: Bearer [REDACTED:auth_header]');
    expect(redactText('curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA=="', plain).text)
      .toBe('curl -H "Authorization: Basic [REDACTED:auth_header]"');
  });

  it('redacts only the password inside a uri, keeping scheme, user and host', () => {
    expect(redactText('connecting postgres://appuser:hunter2@db.internal:5432/app', plain).text)
      .toBe('connecting postgres://appuser:[REDACTED:uri_credentials]@db.internal:5432/app');
    expect(redactText('redis://default:aVeryLongPassword1@cache.svc:6379', plain).text)
      .toBe('redis://default:[REDACTED:uri_credentials]@cache.svc:6379');
  });

  it('redacts provider-prefixed tokens', () => {
    const cases: Array<[string, string]> = [
      [tok('ghp', '_1234567890abcdefghijklmnopqrstuvwxyz'), 'github classic'],
      [tok('gho', '_1234567890abcdefghijklmnopqrstuvwxyz'), 'github oauth'],
      [tok('ghs', '_1234567890abcdefghijklmnopqrstuvwxyz'), 'github server'],
      [tok('ghu', '_1234567890abcdefghijklmnopqrstuvwxyz'), 'github user'],
      [tok('github', '_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz1234567890'), 'fine grained pat'],
      [tok('xox', 'b-123456789012-1234567890123-abcdefghijklmnopqrstuvwx'), 'slack bot'],
      [tok('xox', 'p-123456789012-1234567890123-abcdefghijklmnopqrstuvwx'), 'slack user'],
      [STRIPE_SECRET, 'stripe secret'],
      [tok('AIza', 'SyD-1234567890abcdefghijklmnopqrstu'), 'google api key'],
      [tok('sk-ant', '-api03-abcdefghijklmnopqrstuvwxyz123456'), 'anthropic'],
      [tok('sk-proj', '-abcdefghijklmnopqrstuvwxyz1234567890'), 'openai project'],
      [tok('sk-', 'abcdefghijklmnopqrstuvwxyz1234567890ABCD'), 'openai classic'],
      [tok('glpat', '-abcdefghijklmnopqrstu'), 'gitlab pat'],
      [tok('npm', '_abcdefghijklmnopqrstuvwxyz0123456789'), 'npm token'],
    ];
    for (const [token, label] of cases) {
      expect(redactText(`using ${token} now`, plain).text, label)
        .toBe('using [REDACTED:provider_token] now');
    }
  });

  it('redacts assignment values while keeping the key name readable', () => {
    const cases: Array<[string, string]> = [
      ['MYAPP_PASSWORD=hunter2', 'MYAPP_PASSWORD=[REDACTED:generic_assignment]'],
      ['DB_PASSWD: swordfish', 'DB_PASSWD: [REDACTED:generic_assignment]'],
      ['CLIENT_SECRET="abcd-1234-efgh"', 'CLIENT_SECRET="[REDACTED:generic_assignment]"'],
      ["API_KEY='k-9f8e7d6c'", "API_KEY='[REDACTED:generic_assignment]'"],
      ['SENTRY_DSN=https://abc@o1.ingest.sentry.io/1', 'SENTRY_DSN=[REDACTED:generic_assignment]'],
      ['ACCESS_KEY => a1b2c3d4e5', 'ACCESS_KEY => [REDACTED:generic_assignment]'],
      ['refresh_token: rt_abcdefgh', 'refresh_token: [REDACTED:generic_assignment]'],
    ];
    for (const [input, expected] of cases) {
      expect(redactText(input, plain).text, input).toBe(expected);
    }
  });
});

describe('pii categories', () => {
  it('redacts email addresses', () => {
    expect(redactText('signup alice.smith+tag@example.co.uk ok', plain).text)
      .toBe('signup [REDACTED:email] ok');
    expect(redactText('to=<bob@mail.example.com>', plain).text).toBe('to=<[REDACTED:email]>');
  });

  it('redacts luhn-valid branded card numbers, spaced or not', () => {
    expect(redactText('charged 4111111111111111', plain).text).toBe('charged [REDACTED:credit_card]');
    expect(redactText('charged 4111 1111 1111 1111', plain).text).toBe('charged [REDACTED:credit_card]');
    expect(redactText('charged 4111-1111-1111-1111', plain).text).toBe('charged [REDACTED:credit_card]');
    expect(redactText('amex 378282246310005 ok', plain).text).toBe('amex [REDACTED:credit_card] ok');
  });

  it('does not redact a card-shaped number that fails luhn', () => {
    unchanged('candidate 4111111111111112 rejected');
  });

  it('redacts uk national insurance numbers', () => {
    expect(redactText('ni AB123456C on file', plain).text).toBe('ni [REDACTED:uk_nino] on file');
    expect(redactText('ni AB 12 34 56 C on file', plain).text).toBe('ni [REDACTED:uk_nino] on file');
    // prefixes the scheme never issues stay put.
    unchanged('code BG123456A is not a nino');
    unchanged('code ZZ123456A is not a nino');
  });

  it('redacts mod-97 valid ibans only', () => {
    expect(redactText('paid GB33BUKB20201555555555 today', plain).text)
      .toBe('paid [REDACTED:iban] today');
    expect(redactText('paid DE89370400440532013000 today', plain).text)
      .toBe('paid [REDACTED:iban] today');
    // one digit off, checksum fails, left alone.
    unchanged('paid GB33BUKB20201555555554 today');
    // unknown country code, left alone.
    unchanged('ref QQ33BUKB20201555555555 today');
  });

  it('redacts phone numbers only when the category is enabled', () => {
    unchanged('call +44 7700 900123 later');
    expect(redactText('call +44 7700 900123 later', withPhone).text)
      .toBe('call [REDACTED:phone] later');
    expect(redactText('call 07700900123 later', withPhone).text)
      .toBe('call [REDACTED:phone] later');
  });

  it('redacts public ip addresses only when the category is enabled', () => {
    unchanged('client 93.184.216.34 connected');
    expect(redactText('client 93.184.216.34 connected', withIp).text)
      .toBe('client [REDACTED:ip] connected');
    expect(redactText('peer 2001:db8::1 up', withIp).text).toBe('peer [REDACTED:ip] up');
    expect(redactText('peer 2001:0db8:0000:0000:0000:0000:0000:0001 up', withIp).text)
      .toBe('peer [REDACTED:ip] up');
  });
});

describe('positional and embedding variants', () => {
  const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';

  it('redacts at line start, mid-line and line end', () => {
    expect(redactText(`${secret} used`, plain).text).toBe('[REDACTED:provider_token] used');
    expect(redactText(`auth ${secret} used`, plain).text).toBe('auth [REDACTED:provider_token] used');
    expect(redactText(`auth ${secret}`, plain).text).toBe('auth [REDACTED:provider_token]');
    expect(redactText(secret, plain).text).toBe('[REDACTED:provider_token]');
  });

  it('redacts inside json', () => {
    expect(redactText(`{"token":"${secret}","page":2}`, plain).text)
      .toBe('{"token":"[REDACTED:provider_token]","page":2}');
    expect(redactText('{"apiKey":"abc123XYZ456"}', plain).text)
      .toBe('{"apiKey":"[REDACTED:generic_assignment]"}');
  });

  it('redacts inside a url query string and stops at the ampersand', () => {
    expect(redactText('GET https://api.example.com/v1?api_key=SUPERSECRET&page=2 200', plain).text)
      .toBe('GET https://api.example.com/v1?api_key=[REDACTED:generic_assignment]&page=2 200');
  });

  it('redacts every occurrence across multiple lines', () => {
    const out = redactText(`a ${secret}\nb ${secret}\nc plain`, plain).text;
    expect(out).toBe('a [REDACTED:provider_token]\nb [REDACTED:provider_token]\nc plain');
  });

  it('reports counts per category', () => {
    const r = redactText(`${secret} and alice@example.com and ${secret}`, plain);
    expect(r.counts).toEqual({ provider_token: 2, email: 1 });
  });
});

describe('idempotency, unicode and edge cases', () => {
  it('is idempotent', () => {
    const input = 'MYAPP_PASSWORD=hunter2 user alice@example.com key ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const once = redactText(input, plain).text;
    const twice = redactText(once, plain).text;
    expect(twice).toBe(once);
    expect(redactText(twice, plain).counts).toEqual({});
  });

  it('is idempotent with fingerprints on', () => {
    const cfg = resolveRedaction({});
    const once = redactText('DB_PASSWORD=hunter2', cfg).text;
    expect(once).toMatch(/^DB_PASSWORD=\[REDACTED:generic_assignment#[0-9a-f]{4}\]$/);
    expect(redactText(once, cfg).text).toBe(once);
  });

  it('does not corrupt multi-byte characters or emoji-adjacent text', () => {
    const emoji = '\u{1F680}';
    // built from code points so the source file itself stays pure ascii.
    const cjk = String.fromCodePoint(0x65e5, 0x672c, 0x8a9e);
    const accents = String.fromCodePoint(0x63, 0x61, 0x66, 0xe9);
    const combining = String.fromCodePoint(0x65, 0x301);
    const input = `${emoji} deploy ${cjk} ${accents} ${emoji}`;
    unchanged(input);
    const mixed = `${emoji} PASSWORD=hunter2 ${cjk}`;
    expect(redactText(mixed, plain).text)
      .toBe(`${emoji} PASSWORD=[REDACTED:generic_assignment] ${cjk}`);
    // a combining mark next to a redaction boundary must survive intact.
    expect(redactText(`${combining} PASSWORD=hunter2 ${combining}`, plain).text)
      .toBe(`${combining} PASSWORD=[REDACTED:generic_assignment] ${combining}`);
  });

  it('preserves surrounding whitespace and line structure exactly', () => {
    const input = '  \tPASSWORD=hunter2\t \n\n   next line   \n';
    expect(redactText(input, plain).text)
      .toBe('  \tPASSWORD=[REDACTED:generic_assignment]\t \n\n   next line   \n');
  });

  it('handles empty and whitespace-only input', () => {
    expect(redactText('', plain)).toEqual({ text: '', counts: {} });
    unchanged('   ');
    unchanged('\n\n\t\n');
  });

  it('handles a very long single line', () => {
    const long = 'x'.repeat(500_000);
    unchanged(long);
    const withSecret = `${long} PASSWORD=hunter2 ${long}`;
    const out = redactText(withSecret, plain).text;
    expect(out).toBe(`${long} PASSWORD=[REDACTED:generic_assignment] ${long}`);
  });

  it('redactLine matches redactText for a single line', () => {
    expect(redactLine('DB_PASSWORD=hunter2', plain)).toBe('DB_PASSWORD=[REDACTED:generic_assignment]');
    expect(redactLine('nothing to see', plain)).toBe('nothing to see');
  });
});

describe('fingerprints', () => {
  it('gives the same secret the same fingerprint and different secrets different ones', () => {
    const cfg = resolveRedaction({});
    const out = redactText('a=ghp_1234567890abcdefghijklmnopqrstuvwxyz b=ghp_zzzzzzzzzzabcdefghijklmnopqrstuvwxyz ' +
      'c=ghp_1234567890abcdefghijklmnopqrstuvwxyz', cfg).text;
    const fps = [...out.matchAll(/#([0-9a-f]{4})\]/g)].map(m => m[1]);
    expect(fps).toHaveLength(3);
    expect(fps[0]).toBe(fps[2]);
    expect(fps[0]).not.toBe(fps[1]);
  });

  it('never leaks the secret itself into the placeholder', () => {
    const cfg = resolveRedaction({});
    const out = redactText('K=ghp_1234567890abcdefghijklmnopqrstuvwxyz', cfg).text;
    expect(out).not.toContain('1234567890abcdef');
  });

  it('can be turned off', () => {
    expect(redactText('DB_PASSWORD=hunter2', resolveRedaction({ fingerprint: false })).text)
      .toBe('DB_PASSWORD=[REDACTED:generic_assignment]');
  });

  it('uses a different salt per process, so fingerprints are not comparable across runs', () => {
    const a = resolveRedaction({});
    const b = { ...a, fingerprintSalt: 'a-different-salt' } as typeof a;
    const outA = redactText('K=ghp_1234567890abcdefghijklmnopqrstuvwxyz', a).text;
    const outB = redactText('K=ghp_1234567890abcdefghijklmnopqrstuvwxyz', b).text;
    expect(outA).not.toBe(outB);
  });
});

describe('createLineRedactor streaming state', () => {
  it('suppresses a pem block delivered one line at a time', () => {
    const r = createLineRedactor(plain);
    const lines = [
      'starting up',
      'key follows: -----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAy8Dbv8prpJ/0kKhlGeJYozo2t60EG8L0561g13R29LvMR5hy',
      'vGZlGJpmn65+A4xHXInJYiPuKzrKUnApeLZ+vw1HocOAZtWK0z3r26oZzDMjlbWR',
      '-----END RSA PRIVATE KEY-----',
      'ready on port 3007',
    ];
    const out = lines.map(r);
    expect(out[0]).toBe('starting up');
    expect(out[1]).toBe('key follows: [REDACTED:private_key]');
    expect(out[2]).toBe('');
    expect(out[3]).toBe('');
    expect(out[4]).toBe('');
    expect(out[5]).toBe('ready on port 3007');
    expect(out.join('\n')).not.toContain('MIIEow');
  });

  it('drops out of block state on an interleaved non-pem line', () => {
    const r = createLineRedactor(plain);
    r('-----BEGIN RSA PRIVATE KEY-----');
    expect(r('ERROR upstream 502 from https://api.example.com/v1'))
      .toBe('ERROR upstream 502 from https://api.example.com/v1');
    expect(r('back to normal')).toBe('back to normal');
  });

  it('still redacts ordinary secrets line by line', () => {
    const r = createLineRedactor(plain);
    expect(r('DB_PASSWORD=hunter2')).toBe('DB_PASSWORD=[REDACTED:generic_assignment]');
    expect(r('plain line')).toBe('plain line');
  });

  it('passes everything through when disabled', () => {
    const r = createLineRedactor(resolveRedaction({ enabled: false }));
    expect(r('DB_PASSWORD=hunter2')).toBe('DB_PASSWORD=hunter2');
  });
});

describe('performance budget', () => {
  it('redacts a 5MB synthetic log well inside the fleet logs maxBytes budget', () => {
    const tmpl = [
      '2026-08-09T12:34:56.789Z INFO GET /api/v1/users?page=2 200 12ms pid=48213 rss=104857600',
      '2026-08-09T12:34:57.001Z DEBUG cache hit key=user:550e8400-e29b-41d4-a716-446655440000',
      '2026-08-09T12:34:57.101Z INFO deploy a1b2c3d4 image sha256:9f86d081884c7d659a2feaa0c55ad0' +
        '15a3bf4f1b2b0b822cd15d6c15b0f00a08',
      '2026-08-09T12:34:57.201Z WARN upstream 10.1.2.3:5432 slow query 1234ms token expired',
      '2026-08-09T12:34:57.301Z INFO Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36',
      '2026-08-09T12:34:57.401Z INFO DB_PASSWORD=hunter2 rotated for alice@example.com',
    ];
    const parts: string[] = [];
    for (let i = 0; i < 60_000; i++) parts.push(`${tmpl[i % tmpl.length]}\n`);
    const big = parts.join('').slice(0, 5_000_000);
    expect(big.length).toBe(5_000_000);

    const t0 = performance.now();
    const r = redactText(big, resolveRedaction({ categories: { ip: true } }));
    const elapsed = performance.now() - t0;

    // generous ceiling: a regression that makes fleet logs unusable will blow
    // straight through it, while ci jitter will not.
    expect(elapsed).toBeLessThan(2000);
    expect(r.counts.generic_assignment).toBeGreaterThan(1000);
    expect(r.text).not.toContain('hunter2');
    // the boring lines must come back untouched.
    expect(r.text).toContain('image sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    expect(r.text).toContain('Chrome/120.0.0.0');
    expect(r.text).toContain('10.1.2.3');
  });
});
