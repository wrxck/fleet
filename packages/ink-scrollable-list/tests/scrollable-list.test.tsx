import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import { ScrollableList } from '../src/scrollable-list.js';

const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: `Item ${i}` }));

describe('ScrollableList', () => {
  it('renders only maxVisible items', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 0');
    expect(frame).toContain('Item 4');
    expect(frame).not.toContain('Item 5');
  });

  it('follows cursor when scrolling down', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={7}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 7');
    expect(frame).not.toContain('Item 0');
  });

  it('shows scroll indicators when items above', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={10}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toMatch(/\u2191|above|more/i);
  });

  it('shows scroll indicators when items below', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={0}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toMatch(/\u2193|below|more/i);
  });

  it('renders empty state when no items', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={[]}
        selectedIndex={0}
        maxVisible={5}
        renderItem={(item: { label: string }, selected) => <Text>{item.label}</Text>}
        emptyText="Nothing here"
      />
    );
    expect(lastFrame()).toContain('Nothing here');
  });

  it('clamps scroll offset when selectedIndex is near end', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={19}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 19');
    expect(frame).toContain('Item 15');
  });
});
