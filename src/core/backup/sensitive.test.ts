import { describe, it, expect } from 'vitest';

import { classify } from './sensitive';

describe('backup/sensitive', () => {
  it('flags ssh + gnupg key material', () => {
    expect(classify('/root/.ssh/id_ed25519')).toBe('sensitive');
    expect(classify('/home/matt/.gnupg/secring.gpg')).toBe('sensitive');
    expect(classify('/etc/ssh/ssh_host_rsa_key')).toBe('sensitive');
  });

  it('flags letsencrypt + pem/key files', () => {
    expect(classify('/etc/letsencrypt/live/x/privkey.pem')).toBe('sensitive');
    expect(classify('/srv/app/server.key')).toBe('sensitive');
  });

  it('flags cloud + credential stores', () => {
    expect(classify('/root/.aws/credentials')).toBe('sensitive');
    expect(classify('/root/.secrets/cloudflare.ini')).toBe('sensitive');
    expect(classify('/home/matt/.docker/config.json')).toBe('sensitive');
    expect(classify('/root/.npmrc')).toBe('sensitive');
  });

  it('flags database dumps', () => {
    expect(classify('/all.pg.sql')).toBe('sensitive');
    expect(classify('/all.mysql.sql')).toBe('sensitive');
    expect(classify('/all.mongo.archive')).toBe('sensitive');
    expect(classify('/dump.rdb')).toBe('sensitive');
  });

  it('flags fleet + claude agent state', () => {
    expect(classify('/var/lib/fleet/registry.json')).toBe('sensitive');
    expect(classify('/root/.claude.json')).toBe('sensitive');
  });

  it('is case-insensitive', () => {
    expect(classify('/root/.SSH/ID_RSA')).toBe('sensitive');
  });

  it('treats ordinary app files as normal', () => {
    expect(classify('/home/matt/natures-art/server/index.ts')).toBe('normal');
    expect(classify('/home/matt/app/package.json')).toBe('normal');
    expect(classify('/etc/nginx/nginx.conf')).toBe('normal');
  });
});
