import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { loadNotifyConfig, buildBlueBubblesUrl, scrubSecrets } from './notify';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadNotifyConfig', () => {
  it('returns null when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadNotifyConfig()).toBeNull();
  });

  it('returns null when config file is invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not-json');
    expect(loadNotifyConfig()).toBeNull();
  });

  it('returns parsed config with telegram adapter', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        adapters: [
          { type: 'telegram', botToken: 'abc123', chatId: '456' },
        ],
      })
    );
    const config = loadNotifyConfig();
    expect(config).not.toBeNull();
    expect(config!.adapters).toHaveLength(1);
    expect(config!.adapters[0].type).toBe('telegram');
    expect(config!.adapters[0].botToken).toBe('abc123');
    expect(config!.adapters[0].chatId).toBe('456');
  });

  it('returns parsed config with bluebubbles adapter', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        adapters: [
          {
            type: 'bluebubbles',
            serverUrl: 'https://bb.example.com',
            password: 'secret',
            chatGuid: 'iMessage;-;+15555550100',
          },
        ],
      })
    );
    const config = loadNotifyConfig();
    expect(config).not.toBeNull();
    expect(config!.adapters).toHaveLength(1);
    expect(config!.adapters[0].type).toBe('bluebubbles');
    expect(config!.adapters[0].serverUrl).toBe('https://bb.example.com');
  });

  it('does not duplicate the slash when serverUrl has a trailing slash', () => {
    expect(buildBlueBubblesUrl('https://bb.example.com/', 'pw'))
      .toBe('https://bb.example.com/api/v1/message/text?password=pw');
  });

  it('returns parsed config with multiple adapters', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        adapters: [
          { type: 'telegram', botToken: 'tok', chatId: '1' },
          { type: 'bluebubbles', serverUrl: 'https://bb.example.com', password: 'pw', chatGuid: 'guid' },
        ],
      })
    );
    const config = loadNotifyConfig();
    expect(config).not.toBeNull();
    expect(config!.adapters).toHaveLength(2);
  });
});

describe('buildBlueBubblesUrl', () => {
  it('percent-encodes the password in the query string', () => {
    const url = buildBlueBubblesUrl('https://bb.example.com', 'p@ss w&rd#1');
    expect(url).toBe('https://bb.example.com/api/v1/message/text?password=p%40ss%20w%26rd%231');
    // the raw secret must not appear unencoded (it would corrupt/leak the request)
    expect(url).not.toContain('p@ss w&rd#1');
  });
});

describe('scrubSecrets', () => {
  it('redacts raw and percent-encoded secret occurrences', () => {
    const msg = 'fetch to https://api.telegram.org/bot12345:AAToken/sendMessage failed (pw=s p@ce, enc=s%20p%40ce)';
    const out = scrubSecrets(msg, ['12345:AAToken', 's p@ce']);
    expect(out).not.toContain('12345:AAToken');
    expect(out).not.toContain('s p@ce');
    expect(out).not.toContain('s%20p%40ce');
    expect(out).toContain('[redacted]');
  });

  it('ignores undefined / empty secrets', () => {
    expect(scrubSecrets('hello', [undefined, ''])).toBe('hello');
  });
});
