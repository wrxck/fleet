import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeMcpContext, makeCliContext } from './context';

const { mockQuestion, mockClose, mockOn, mockCreateInterface } = vi.hoisted(() => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  const mockOn = vi.fn();
  const mockCreateInterface = vi.fn(() => ({ question: mockQuestion, close: mockClose, on: mockOn }));
  return { mockQuestion, mockClose, mockOn, mockCreateInterface };
});

vi.mock('node:readline', () => ({ createInterface: mockCreateInterface }));

describe('command context builders', () => {
  beforeEach(() => {
    mockQuestion.mockReset();
    mockClose.mockReset();
    mockOn.mockReset();
  });

  it('cli confirm resolves true for a "y" answer', async () => {
    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => cb('y'));
    expect(await makeCliContext().confirm('go?')).toBe(true);
    expect(mockClose).toHaveBeenCalled();
  });

  it('cli confirm resolves false for empty input', async () => {
    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => cb(''));
    expect(await makeCliContext().confirm('go?')).toBe(false);
  });

  it('cli confirm prompt includes the [y/N] hint', async () => {
    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => cb('n'));
    await makeCliContext().confirm('delete?');
    expect(String(mockQuestion.mock.calls[0][0])).toContain('[y/N]');
  });

  it('mcp context resolves confirm from the confirm flag', async () => {
    const granted = makeMcpContext(true);
    const denied = makeMcpContext(false);
    expect(await granted.confirm('go?')).toBe(true);
    expect(await denied.confirm('go?')).toBe(false);
  });

  it('cli context exposes process.env', () => {
    expect(makeCliContext().env).toBe(process.env);
  });

  it('mcp context log does not throw', () => {
    expect(() => makeMcpContext(true).log({ level: 'info', message: 'hi' })).not.toThrow();
  });
});
