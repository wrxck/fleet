import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { isAppendOnly } from './repo';

describe('isAppendOnly', () => {
  const original = process.env.FLEET_BACKUP_BASE_URL;
  beforeEach(() => { delete process.env.FLEET_BACKUP_BASE_URL; });
  afterEach(() => {
    if (original === undefined) delete process.env.FLEET_BACKUP_BASE_URL;
    else process.env.FLEET_BACKUP_BASE_URL = original;
  });

  it('returns false when no base url is set (legacy sftp default)', () => {
    expect(isAppendOnly()).toBe(false);
  });

  it('returns true for rest: backends', () => {
    process.env.FLEET_BACKUP_BASE_URL = 'rest:http://10.99.0.2:14739';
    expect(isAppendOnly()).toBe(true);
  });

  it('returns true for rest:https:// backends', () => {
    process.env.FLEET_BACKUP_BASE_URL = 'rest:https://example.invalid';
    expect(isAppendOnly()).toBe(true);
  });

  it('returns false for explicit sftp: base url', () => {
    process.env.FLEET_BACKUP_BASE_URL = 'sftp:somehost:';
    expect(isAppendOnly()).toBe(false);
  });

  it('returns false for s3: backends (no append-only enforcement by default)', () => {
    process.env.FLEET_BACKUP_BASE_URL = 's3:s3.amazonaws.com/bucket';
    expect(isAppendOnly()).toBe(false);
  });
});
