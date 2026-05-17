import { describe, it, expect } from 'vitest';

import { resolveAscCredentials, hasAscCredentials, easEnv } from './credentials';

const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nMIGdummy\n-----END PRIVATE KEY-----';
const FAKE_KEY_B64 = Buffer.from(FAKE_KEY).toString('base64');

describe('resolveAscCredentials', () => {
  it('resolves credentials from a base64 private key', () => {
    const creds = resolveAscCredentials({
      ASC_API_KEY_ID: 'KEY1',
      ASC_API_KEY_ISSUER_ID: 'ISS1',
      ASC_API_KEY_B64: FAKE_KEY_B64,
    });
    expect(creds).toEqual({ keyId: 'KEY1', issuerId: 'ISS1', privateKey: FAKE_KEY });
  });

  it('throws when the key id or issuer id is missing', () => {
    expect(() => resolveAscCredentials({ ASC_API_KEY_B64: FAKE_KEY_B64 })).toThrow(
      /credentials missing/,
    );
  });

  it('throws when no private key is supplied', () => {
    expect(() =>
      resolveAscCredentials({ ASC_API_KEY_ID: 'KEY1', ASC_API_KEY_ISSUER_ID: 'ISS1' }),
    ).toThrow(/private key missing/);
  });
});

describe('hasAscCredentials', () => {
  it('is true with a full credential set', () => {
    expect(
      hasAscCredentials({
        ASC_API_KEY_ID: 'KEY1',
        ASC_API_KEY_ISSUER_ID: 'ISS1',
        ASC_API_KEY_B64: FAKE_KEY_B64,
      }),
    ).toBe(true);
  });

  it('is false when anything is missing', () => {
    expect(hasAscCredentials({ ASC_API_KEY_ID: 'KEY1' })).toBe(false);
  });
});

describe('easEnv', () => {
  it('picks only the keys eas consumes', () => {
    expect(
      easEnv({
        EXPO_TOKEN: 'tok',
        APPLE_ID: 'a@b.com',
        ASC_APP_ID: '123',
        UNRELATED: 'drop me',
      }),
    ).toEqual({ EXPO_TOKEN: 'tok', APPLE_ID: 'a@b.com', ASC_APP_ID: '123' });
  });
});
