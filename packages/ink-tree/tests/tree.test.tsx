import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';

import { Tree, type TreeNode } from '../src/index.js';

const tree: TreeNode[] = [
  {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'a', label: 'Alpha' },
      {
        id: 'b',
        label: 'Bravo',
        children: [
          { id: 'b1', label: 'Bravo-1' },
          { id: 'b2', label: 'Bravo-2' },
        ],
      },
      { id: 'c', label: 'Charlie' },
    ],
  },
];

describe('Tree', () => {
  it('renders tree with indentation', () => {
    const expanded = new Set(['root', 'b']);
    const { lastFrame } = render(
      <Tree nodes={tree} expandedIds={expanded} />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain('Root');
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Bravo');
    expect(frame).toContain('Bravo-1');
    expect(frame).toContain('Bravo-2');
    expect(frame).toContain('Charlie');
  });

  it('hides collapsed children', () => {
    const expanded = new Set(['root']);
    const { lastFrame } = render(
      <Tree nodes={tree} expandedIds={expanded} />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain('Root');
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Bravo');
    expect(frame).not.toContain('Bravo-1');
    expect(frame).not.toContain('Bravo-2');
    expect(frame).toContain('Charlie');
  });

  it('renders selected node', () => {
    const expanded = new Set(['root']);
    const { lastFrame } = render(
      <Tree nodes={tree} expandedIds={expanded} selectedId="a" />,
    );
    const frame = lastFrame()!;
    // selected node should be present
    expect(frame).toContain('Alpha');
  });

  it('shows expand indicators', () => {
    const expanded = new Set(['root']);
    const { lastFrame } = render(
      <Tree nodes={tree} expandedIds={expanded} />,
    );
    const frame = lastFrame()!;

    // root is expanded
    expect(frame).toContain('\u25bc');
    // bravo has children but collapsed
    expect(frame).toContain('\u25b6');
    // alpha is a leaf
    expect(frame).toContain('\u00b7');
  });

  it('shows tree connector lines', () => {
    const expanded = new Set(['root']);
    const { lastFrame } = render(
      <Tree nodes={tree} expandedIds={expanded} />,
    );
    const frame = lastFrame()!;

    // middle children get connector
    expect(frame).toContain('\u251c\u2500');
    // last child gets end connector
    expect(frame).toContain('\u2514\u2500');
  });

  it('supports custom renderNode', () => {
    const expanded = new Set(['root']);
    const { lastFrame } = render(
      <Tree
        nodes={tree}
        expandedIds={expanded}
        renderNode={(node, _depth, selected) => (
          <Text>{selected ? '>> ' : ''}{node.label.toUpperCase()}</Text>
        )}
      />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain('ALPHA');
    expect(frame).toContain('BRAVO');
  });

  it('windows the list when maxVisible is set', () => {
    const expanded = new Set(['root', 'b']);
    const { lastFrame } = render(
      <Tree nodes={tree} expandedIds={expanded} maxVisible={3} selectedId="root" />,
    );
    const frame = lastFrame()!;

    expect(frame).toContain('Root');
    // should show more below indicator
    expect(frame).toMatch(/below|more/i);
  });
});
