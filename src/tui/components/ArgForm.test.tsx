import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { ArgForm } from './ArgForm';

describe('ArgForm', () => {
  it('renders one labelled field per schema property', () => {
    const schema = z.object({ app: z.string(), force: z.boolean().default(false) });
    const { lastFrame } = render(<ArgForm schema={schema} onSubmit={() => {}} onCancel={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('app');
    expect(frame).toContain('force');
  });

  it('shows a toggle hint for boolean fields', () => {
    const schema = z.object({ force: z.boolean().default(false) });
    const { lastFrame } = render(<ArgForm schema={schema} onSubmit={() => {}} onCancel={() => {}} />);
    expect(lastFrame() ?? '').toMatch(/false|off|\[ \]/i);
  });
});
