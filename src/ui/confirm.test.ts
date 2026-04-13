import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuestion, mockClose, mockCreateInterface } = vi.hoisted(() => {
  const mockQuestion = vi.fn();
  const mockClose = vi.fn();
  const mockCreateInterface = vi.fn().mockReturnValue({
    question: mockQuestion,
    close: mockClose,
  });
  return { mockQuestion, mockClose, mockCreateInterface };
});

vi.mock('node:readline', () => ({
  createInterface: mockCreateInterface,
}));

import { confirm } from './confirm.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateInterface.mockReturnValue({
    question: mockQuestion,
    close: mockClose,
  });
});

function simulateAnswer(answer: string) {
  mockQuestion.mockImplementation((_prompt: string, cb: (s: string) => void) => {
    cb(answer);
  });
}

describe('confirm', () => {
  it('resolves true when user enters y', async () => {
    simulateAnswer('y');
    expect(await confirm('Continue?')).toBe(true);
  });

  it('resolves true when user enters Y', async () => {
    simulateAnswer('Y');
    expect(await confirm('Continue?')).toBe(true);
  });

  it('resolves true when user enters yes', async () => {
    simulateAnswer('yes');
    expect(await confirm('Continue?')).toBe(true);
  });

  it('resolves false when user enters n', async () => {
    simulateAnswer('n');
    expect(await confirm('Continue?')).toBe(false);
  });

  it('resolves false when user enters N', async () => {
    simulateAnswer('N');
    expect(await confirm('Continue?')).toBe(false);
  });

  it('resolves false when user enters no', async () => {
    simulateAnswer('no');
    expect(await confirm('Continue?')).toBe(false);
  });

  it('defaults to false when user presses enter (defaultYes=false)', async () => {
    simulateAnswer('');
    expect(await confirm('Continue?', false)).toBe(false);
  });

  it('defaults to true when user presses enter (defaultYes=true)', async () => {
    simulateAnswer('');
    expect(await confirm('Continue?', true)).toBe(true);
  });

  it('closes readline interface after answering', async () => {
    simulateAnswer('y');
    await confirm('Continue?');
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('shows [Y/n] hint when defaultYes=true', async () => {
    simulateAnswer('y');
    await confirm('Delete this?', true);
    const promptArg = mockQuestion.mock.calls[0][0] as string;
    expect(promptArg).toContain('[Y/n]');
  });

  it('shows [y/N] hint when defaultYes=false', async () => {
    simulateAnswer('n');
    await confirm('Delete this?', false);
    const promptArg = mockQuestion.mock.calls[0][0] as string;
    expect(promptArg).toContain('[y/N]');
  });

  it('includes message in prompt', async () => {
    simulateAnswer('y');
    await confirm('Are you sure?');
    const promptArg = mockQuestion.mock.calls[0][0] as string;
    expect(promptArg).toContain('Are you sure?');
  });

  it('trims whitespace from answer', async () => {
    simulateAnswer('  y  ');
    expect(await confirm('Continue?')).toBe(true);
  });

  it('resolves false for any unexpected input', async () => {
    simulateAnswer('maybe');
    expect(await confirm('Continue?')).toBe(false);
  });
});
