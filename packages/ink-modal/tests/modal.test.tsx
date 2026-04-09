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

  it('renders children without title when title is omitted', () => {
    const { lastFrame } = render(
      <Modal visible={true}>
        <Text>No title here</Text>
      </Modal>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('No title here');
  });

  it('renders with custom width', () => {
    const { lastFrame } = render(
      <Modal visible={true} width={30} title="Narrow">
        <Text>Small modal</Text>
      </Modal>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Narrow');
    expect(frame).toContain('Small modal');
  });

  it('renders with custom borderColor', () => {
    const { lastFrame } = render(
      <Modal visible={true} borderColor="red" title="Red border">
        <Text>Colored</Text>
      </Modal>
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Red border');
    expect(frame).toContain('Colored');
  });
});
