import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { KeyBindingHelp, type KeyBindingGroup } from '../src/keybinding-help.js';

const sampleGroups: KeyBindingGroup[] = [
  {
    title: 'Navigation',
    bindings: [
      { key: 'j/k', description: 'navigate list' },
      { key: 'Tab', description: 'switch view' },
    ],
  },
  {
    title: 'Actions',
    bindings: [
      { key: 'Enter', description: 'confirm selection' },
      { key: 'q', description: 'quit' },
    ],
  },
];

describe('KeyBindingHelp', () => {
  it('renders title and groups', () => {
    const { lastFrame } = render(<KeyBindingHelp groups={sampleGroups} />);
    const output = lastFrame()!;
    expect(output).toContain('Keyboard Shortcuts');
    expect(output).toContain('Navigation');
    expect(output).toContain('Actions');
  });

  it('shows key-description pairs', () => {
    const { lastFrame } = render(<KeyBindingHelp groups={sampleGroups} />);
    const output = lastFrame()!;
    expect(output).toContain('j/k');
    expect(output).toContain('navigate list');
    expect(output).toContain('Enter');
    expect(output).toContain('confirm selection');
  });

  it('renders nothing when visible=false', () => {
    const { lastFrame } = render(<KeyBindingHelp groups={sampleGroups} visible={false} />);
    expect(lastFrame()).toBe('');
  });

  it('handles multiple groups', () => {
    const manyGroups: KeyBindingGroup[] = [
      { title: 'Group A', bindings: [{ key: 'a', description: 'action a' }] },
      { title: 'Group B', bindings: [{ key: 'b', description: 'action b' }] },
      { title: 'Group C', bindings: [{ key: 'c', description: 'action c' }] },
    ];
    const { lastFrame } = render(<KeyBindingHelp groups={manyGroups} columns={2} />);
    const output = lastFrame()!;
    expect(output).toContain('Group A');
    expect(output).toContain('Group B');
    expect(output).toContain('Group C');
    expect(output).toContain('action a');
    expect(output).toContain('action b');
    expect(output).toContain('action c');
  });
});
