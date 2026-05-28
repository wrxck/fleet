import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';

import { ascJwt, listBuilds, expireBuild } from './asc';
import type { AscCredentials } from './types';

const { privateKey: PK, publicKey: PUB } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const CREDS: AscCredentials = { keyId: 'KEY123', issuerId: 'ISS-456', privateKey: PK };

afterEach(() => vi.unstubAllGlobals());

describe('ascJwt', () => {
  it('produces a verifiable ES256 jwt with the apple audience', () => {
    const jwt = ascJwt(CREDS, 1_700_000_000_000);
    const [h, p, s] = jwt.split('.');

    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(payload).toMatchObject({ iss: 'ISS-456', aud: 'appstoreconnect-v1' });
    expect(payload.exp - payload.iat).toBe(600);

    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: PUB, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    expect(ok).toBe(true);
  });
});

describe('listBuilds', () => {
  it('maps the json:api response and joins the pre-release version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: 'b1',
        attributes: {
          version: '42', processingState: 'VALID',
          expired: false, uploadedDate: '2026-05-17T10:00:00Z',
        },
        relationships: { preReleaseVersion: { data: { id: 'prv1' } } },
      }],
      included: [{ type: 'preReleaseVersions', id: 'prv1', attributes: { version: '0.1.0' } }],
    }), { status: 200 })));

    const builds = await listBuilds(CREDS, 'app1');
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({
      id: 'b1', version: '42', shortVersion: '0.1.0', expired: false,
    });
  });
});

describe('expireBuild', () => {
  it('throws a FleetError carrying apple\'s error detail on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ errors: [{ detail: 'Build not found' }] }),
      { status: 404 },
    )));
    await expect(expireBuild(CREDS, 'missing')).rejects.toThrow(/Build not found/);
  });
});
