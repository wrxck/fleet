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

  it('handles selectedIndex out of bounds without crashing', () => {
    const { lastFrame } = render(
      <ScrollableList
        items={items}
        selectedIndex={999}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 19');
  });

  it('shows all items when maxVisible exceeds items.length', () => {
    const shortItems = [
      { id: '0', label: 'A' },
      { id: '1', label: 'B' },
      { id: '2', label: 'C' },
    ];
    const { lastFrame } = render(
      <ScrollableList
        items={shortItems}
        selectedIndex={0}
        maxVisible={10}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
    expect(frame).not.toMatch(/\u2191|above|more/i);
    expect(frame).not.toMatch(/\u2193|below|more/i);
  });

  it('maintains scroll position when moving up within visible range', () => {
    // scrolled down to index 10, viewport should show ~6-10
    const { lastFrame, rerender } = render(
      <ScrollableList
        items={items}
        selectedIndex={10}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    expect(lastFrame()).toContain('Item 10');
    expect(lastFrame()).not.toContain('Item 0');

    // move up one — should keep the viewport stable, not jump to top
    rerender(
      <ScrollableList
        items={items}
        selectedIndex={9}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Item 9');
    // should still be scrolled — item 0 should not be visible
    expect(frame).not.toContain('Item 0');
  });

  it('scrolls smoothly one item at a time going down', () => {
    const { lastFrame, rerender } = render(
      <ScrollableList
        items={items}
        selectedIndex={4}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    // items 0-4 visible, selected at 4
    expect(lastFrame()).toContain('Item 0');
    expect(lastFrame()).toContain('Item 4');

    // move to 5 — should scroll by 1
    rerender(
      <ScrollableList
        items={items}
        selectedIndex={5}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    expect(lastFrame()).toContain('Item 5');
    expect(lastFrame()).toContain('Item 1');
    expect(lastFrame()).not.toContain('Item 0');
  });

  it('preserves offset when selection stays within visible window', () => {
    // start scrolled down
    const { lastFrame, rerender } = render(
      <ScrollableList
        items={items}
        selectedIndex={12}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    expect(lastFrame()).toContain('Item 12');

    // move up to 11 — should stay in same window
    rerender(
      <ScrollableList
        items={items}
        selectedIndex={11}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    expect(lastFrame()).toContain('Item 11');
    expect(lastFrame()).toContain('Item 12');

    // move up to 10
    rerender(
      <ScrollableList
        items={items}
        selectedIndex={10}
        maxVisible={5}
        renderItem={(item, selected) => (
          <Text>{selected ? '> ' : '  '}{item.label}</Text>
        )}
      />
    );
    expect(lastFrame()).toContain('Item 10');
    expect(lastFrame()).toContain('Item 12');
  });
});
