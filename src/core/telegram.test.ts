import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from 'node:fs';
import { loadTelegramConfig, sendTelegram } from './telegram.js';

const mockExists = existsSync as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockReturnValue(false);
});

describe('loadTelegramConfig', () => {
  it('returns null when config file does not exist', () => {
    mockExists.mockReturnValue(false);
    expect(loadTelegramConfig()).toBeNull();
  });

  it('returns null when JSON is invalid', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue('not json{{{');
    expect(loadTelegramConfig()).toBeNull();
  });

  it('returns null when botToken is missing', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ chatId: '123' }));
    expect(loadTelegramConfig()).toBeNull();
  });

  it('returns null when chatId is missing', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ botToken: 'tok123' }));
    expect(loadTelegramConfig()).toBeNull();
  });

  it('returns config when both fields are present', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ botToken: 'tok123', chatId: '456' }));
    const cfg = loadTelegramConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.botToken).toBe('tok123');
    expect(cfg!.chatId).toBe('456');
  });

  it('coerces numeric chatId to string', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ botToken: 'tok', chatId: 999 }));
    const cfg = loadTelegramConfig();
    expect(cfg!.chatId).toBe('999');
    expect(typeof cfg!.chatId).toBe('string');
  });

  it('coerces numeric botToken to string', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(JSON.stringify({ botToken: 12345, chatId: '678' }));
    const cfg = loadTelegramConfig();
    expect(typeof cfg!.botToken).toBe('string');
  });

  it('returns null when file read throws', () => {
    mockExists.mockReturnValue(true);
    mockRead.mockImplementation(() => { throw new Error('EACCES'); });
    expect(loadTelegramConfig()).toBeNull();
  });
});

describe('sendTelegram', () => {
  const config = { botToken: 'test-token', chatId: 'test-chat' };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true on successful API response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const result = await sendTelegram(config, 'hello');
    expect(result).toBe(true);
  });

  it('returns false on non-ok API response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await sendTelegram(config, 'hello');
    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await sendTelegram(config, 'hello');
    expect(result).toBe(false);
  });

  it('sends message to correct Telegram URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    await sendTelegram(config, 'test message');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('api.telegram.org');
    expect(url).toContain('test-token');
    expect(url).toContain('sendMessage');
  });

  it('sends message as POST with JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    await sendTelegram(config, 'hello world');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toContain('application/json');
    const body = JSON.parse(opts.body);
    expect(body.text).toBe('hello world');
    expect(body.chat_id).toBe('test-chat');
  });

  it('uses HTML parse_mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    await sendTelegram(config, '<b>bold</b>');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parse_mode).toBe('HTML');
  });

  it('message sanitization: HTML tags are passed through (Telegram handles them)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock;
    const msg = '<b>Alert</b>: something happened';
    await sendTelegram(config, msg);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe(msg);
  });
});
