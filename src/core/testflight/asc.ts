import { createSign } from 'node:crypto';

import { FleetError } from '../errors';
import type { AscCredentials, TestflightBuild } from './types';

const ASC_BASE = 'https://api.appstoreconnect.apple.com';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// sign a short-lived ES256 jwt for the app store connect api. the lifetime
// is held well under apple's 20-minute ceiling.
export function ascJwt(creds: AscCredentials, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: creds.keyId, typ: 'JWT' };
  const payload = { iss: creds.issuerId, iat, exp: iat + 600, aud: 'appstoreconnect-v1' };
  const signingInput =
    `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  // apple expects the raw r||s signature (ieee-p1363), not asn.1/der.
  const signature = signer.sign({ key: creds.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64url(signature)}`;
}

interface AscRequestOptions {
  method?: string;
  body?: unknown;
}

// perform an authenticated app store connect api request. a non-2xx response
// is surfaced as a FleetError carrying apple's first error detail.
export async function ascRequest(
  creds: AscCredentials,
  path: string,
  opts: AscRequestOptions = {},
): Promise<unknown> {
  const res = await fetch(`${ASC_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${ascJwt(creds)}`,
      'Content-Type': 'application/json',
    },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (json as { errors?: Array<{ detail?: string }> })?.errors?.[0]?.detail;
    throw new FleetError(`App Store Connect API ${res.status}: ${detail ?? text.slice(0, 200)}`);
  }
  return json;
}

interface BuildResource {
  id: string;
  attributes?: {
    version?: string;
    processingState?: string;
    expired?: boolean;
    uploadedDate?: string;
  };
  relationships?: { preReleaseVersion?: { data?: { id?: string } | null } };
}

// list builds for an app store connect app, newest upload first.
export async function listBuilds(
  creds: AscCredentials,
  ascAppId: string,
  limit = 20,
): Promise<TestflightBuild[]> {
  const query =
    `filter[app]=${encodeURIComponent(ascAppId)}&sort=-uploadedDate` +
    `&limit=${limit}&include=preReleaseVersion`;
  const res = (await ascRequest(creds, `/v1/builds?${query}`)) as {
    data?: BuildResource[];
    included?: Array<{ type: string; id: string; attributes?: { version?: string } }>;
  };
  const preReleaseVersions = new Map(
    (res.included ?? [])
      .filter(i => i.type === 'preReleaseVersions')
      .map(i => [i.id, i.attributes?.version ?? '']),
  );
  return (res.data ?? []).map(b => ({
    id: b.id,
    version: b.attributes?.version ?? '',
    shortVersion: preReleaseVersions.get(b.relationships?.preReleaseVersion?.data?.id ?? '') ?? '',
    processingState: b.attributes?.processingState ?? 'UNKNOWN',
    expired: b.attributes?.expired ?? false,
    uploadedDate: b.attributes?.uploadedDate ?? '',
  }));
}

// expire a build — the closest the api offers to "delete". an expired build
// leaves testflight and can no longer be installed by testers.
export async function expireBuild(creds: AscCredentials, buildId: string): Promise<void> {
  await ascRequest(creds, `/v1/builds/${buildId}`, {
    method: 'PATCH',
    body: { data: { type: 'builds', id: buildId, attributes: { expired: true } } },
  });
}

// set the "what to test" notes for a build, creating the beta localisation
// when the build has none for the requested locale yet.
export async function setWhatsNew(
  creds: AscCredentials,
  buildId: string,
  whatsNew: string,
  locale = 'en-GB',
): Promise<void> {
  const existing = (await ascRequest(
    creds,
    `/v1/builds/${buildId}/betaBuildLocalizations`,
  )) as { data?: Array<{ id: string; attributes?: { locale?: string } }> };

  const match =
    (existing.data ?? []).find(l => l.attributes?.locale === locale) ??
    (existing.data ?? [])[0];

  if (match) {
    await ascRequest(creds, `/v1/betaBuildLocalizations/${match.id}`, {
      method: 'PATCH',
      body: {
        data: { type: 'betaBuildLocalizations', id: match.id, attributes: { whatsNew } },
      },
    });
    return;
  }

  await ascRequest(creds, '/v1/betaBuildLocalizations', {
    method: 'POST',
    body: {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale, whatsNew },
        relationships: { build: { data: { type: 'builds', id: buildId } } },
      },
    },
  });
}

// fetch an app's name — a cheap call used to verify credentials and the
// configured app id resolve.
export async function verifyApp(creds: AscCredentials, ascAppId: string): Promise<string> {
  const res = (await ascRequest(creds, `/v1/apps/${ascAppId}`)) as {
    data?: { attributes?: { name?: string } };
  };
  return res.data?.attributes?.name ?? '(unknown)';
}
