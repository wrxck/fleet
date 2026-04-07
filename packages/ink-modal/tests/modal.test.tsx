import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';

import { Modal } from '../src/modal.js';

describe('ink-modal', () => {
  it('renders nothing when not visible', () => {
    const { lastFrame } = render(
      <Modal visible={false}>
        <Text>Hidden content</Text>
      </Modal>
    );
    expect(lastFrame()).toBe('');
  });

  it('renders title and children when visible', () => {
    const { lastFrame } = render(
      <Modal visible={true} title="My Dialog">
        <Text>Body content here</Text>
      </Modal>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('My Dialog');
    expect(frame).toContain('Body content here');
  });

  it('renders footer when provided', () => {
    const { lastFrame } = render(
      <Modal visible={true} footer="[Enter] Confirm  [Esc] Cancel">
        <Text>Content</Text>
      </Modal>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('[Enter] Confirm  [Esc] Cancel');
  });
});
