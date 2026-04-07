import React from 'react';
import { Box, Text } from 'ink';

export interface KeyBinding {
  key: string;
  description: string;
}

export interface KeyBindingGroup {
  title: string;
  bindings: KeyBinding[];
}

export interface KeyBindingHelpProps {
  groups: KeyBindingGroup[];
  title?: string;
  columns?: number;
  visible?: boolean;
}

export function KeyBindingHelp({
  groups,
  title = 'Keyboard Shortcuts',
  columns = 2,
  visible = true,
}: KeyBindingHelpProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  // find the max key width across all bindings for alignment
  const maxKeyWidth = groups.reduce((max, group) => {
    return group.bindings.reduce((m, b) => Math.max(m, b.key.length), max);
  }, 0);

  // distribute groups across columns
  const columnGroups: KeyBindingGroup[][] = Array.from({ length: columns }, () => []);
  groups.forEach((group, i) => {
    columnGroups[i % columns]!.push(group);
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>
      <Box flexDirection="row">
        {columnGroups.map((colGroups, colIndex) => (
          <Box key={colIndex} flexDirection="column" marginRight={colIndex < columns - 1 ? 2 : 0} flexGrow={1}>
            {colGroups.map((group) => (
              <Box key={group.title} flexDirection="column" marginBottom={1}>
                <Text bold underline>{group.title}</Text>
                {group.bindings.map((binding) => (
                  <Box key={binding.key}>
                    <Text dimColor>{binding.key.padEnd(maxKeyWidth + 2)}</Text>
                    <Text>{binding.description}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
