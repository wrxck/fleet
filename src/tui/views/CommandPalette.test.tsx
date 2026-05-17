import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { InputDispatcher } from '@matthesketh/ink-input-dispatcher';

vi.mock('../exec-bridge', () => ({
  runFleetCommand: vi.fn(async () => ({ ok: true, output: 'done' })),
}));

import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  it('lists registry commands', async () => {
    const { lastFrame } = render(
      <InputDispatcher globalHandler={() => false}>
        <CommandPalette onOpenView={() => {}} onClose={() => {}} />
      </InputDispatcher>,
    );
    await new Promise(r => setTimeout(r, 30));
    expect(lastFrame() ?? '').toContain('status');
  });
});
