import React from 'react';

import { Box, Text } from 'ink';
import { FuzzySelect } from '@matthesketh/ink-fuzzy-select';

export interface PaletteAction {
  id: string;
  label: string;
  group: 'nav' | 'routine' | 'repo' | 'action';
}

export interface CommandPaletteProps {
  actions: PaletteAction[];
  onSelect(action: PaletteAction): void;
  onCancel(): void;
}

const GROUP_COLOR: Record<PaletteAction['group'], string> = {
  nav: 'cyan',
  routine: 'magenta',
  repo: 'yellow',
  action: 'green',
};

export function CommandPalette({ actions, onSelect, onCancel }: CommandPaletteProps): React.JSX.Element {
  const items = actions.map(a => ({ label: a.label, value: a.id }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">⌘  command palette</Text>
      <FuzzySelect
        items={items}
        onSelect={(item) => {
          const found = actions.find(a => a.id === item.value);
          if (found) onSelect(found);
        }}
        onCancel={onCancel}
        placeholder="type to search commands…"
        maxVisible={10}
        renderItem={(item, selected) => {
          const full = actions.find(a => a.id === item.value);
          const color = full ? GROUP_COLOR[full.group] : 'gray';
          return (
            <Box>
              <Box width={2}><Text color={selected ? 'cyan' : undefined}>{selected ? '▶' : ' '}</Text></Box>
              <Box width={10}><Text color={color}>[{full?.group ?? '?'}]</Text></Box>
              <Text color={selected ? 'cyan' : undefined}>{item.label}</Text>
            </Box>
          );
        }}
      />
      <Text color="gray">Enter select · Esc cancel</Text>
    </Box>
  );
}
