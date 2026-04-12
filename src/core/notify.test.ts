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
import { loadNotifyConfig } from './notify.js';

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
