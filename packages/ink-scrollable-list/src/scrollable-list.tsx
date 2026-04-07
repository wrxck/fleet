import React, { useMemo } from 'react';

import { Box, Text } from 'ink';

export interface ScrollableListProps<T> {
  items: T[];
  selectedIndex: number;
  maxVisible: number;
  renderItem: (item: T, selected: boolean, index: number) => React.ReactNode;
  emptyText?: string;
}

export function ScrollableList<T>({
  items,
  selectedIndex,
  maxVisible,
  renderItem,
  emptyText = 'No items',
}: ScrollableListProps<T>): React.JSX.Element {
  const { visibleItems, scrollOffset, hasAbove, hasBelow } = useMemo(() => {
    if (items.length === 0) {
      return { visibleItems: [] as T[], scrollOffset: 0, hasAbove: false, hasBelow: false };
    }

    const clampedIndex = Math.min(selectedIndex, items.length - 1);
    const displayRows = Math.min(maxVisible, items.length);

    let offset = 0;

    // follow cursor: ensure selectedIndex is visible
    if (clampedIndex >= offset + displayRows) {
      offset = clampedIndex - displayRows + 1;
    }
    if (clampedIndex < offset) {
      offset = clampedIndex;
    }

    // clamp offset
    offset = Math.max(0, Math.min(offset, items.length - displayRows));

    return {
      visibleItems: items.slice(offset, offset + displayRows),
      scrollOffset: offset,
      hasAbove: offset > 0,
      hasBelow: offset + displayRows < items.length,
    };
  }, [items, selectedIndex, maxVisible]);

  if (items.length === 0) {
    return <Text dimColor>{emptyText}</Text>;
  }

  return (
    <Box flexDirection="column">
      {hasAbove && (
        <Text dimColor>  {'\u2191'} {scrollOffset} more above</Text>
      )}
      {visibleItems.map((item, i) => {
        const actualIndex = scrollOffset + i;
        return (
          <Box key={actualIndex}>
            {renderItem(item, actualIndex === selectedIndex, actualIndex)}
          </Box>
        );
      })}
      {hasBelow && (
        <Text dimColor>  {'\u2193'} {items.length - scrollOffset - visibleItems.length} more below</Text>
      )}
    </Box>
  );
}
