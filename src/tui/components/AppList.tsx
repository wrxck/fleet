import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme.js';

interface AppListItem {
  name: string;
  label?: string;
}

interface AppListProps {
  items: AppListItem[];
  onSelect: (item: AppListItem) => void;
  renderItem?: (item: AppListItem, selected: boolean) => React.JSX.Element;
}

export function AppList({ items, onSelect, renderItem }: AppListProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (items.length === 0) return;

    if (input === 'j' || key.downArrow) {
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
    } else if (input === 'k' || key.upArrow) {
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (key.return) {
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex]);
      }
    }
  });

  if (items.length === 0) {
    return <Text color={colors.muted}>No items</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const selected = i === selectedIndex;
        if (renderItem) {
          return (
            <Box key={item.name}>
              <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
              {renderItem(item, selected)}
            </Box>
          );
        }
        return (
          <Text key={item.name} bold={selected} color={selected ? colors.primary : colors.text}>
            {selected ? '> ' : '  '}{item.label ?? item.name}
          </Text>
        );
      })}
    </Box>
  );
}
