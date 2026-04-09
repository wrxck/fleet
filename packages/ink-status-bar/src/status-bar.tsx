import React from 'react';
import { Box, Text } from 'ink';

export interface KeyHint {
  key: string;
  label: string;
}

export interface StatusBarProps {
  items?: KeyHint[];
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  backgroundColor?: string;
  color?: string;
}

function KeyHints({ items }: { items: KeyHint[] }): React.JSX.Element {
  return (
    <>
      {items.map((item, i) => (
        <Text key={i}>
          {i > 0 ? ' ' : ''}
          <Text bold>[{item.key}]</Text> {item.label}
        </Text>
      ))}
    </>
  );
}

export function StatusBar({
  items,
  left,
  center,
  right,
  backgroundColor = 'gray',
  color = 'white',
}: StatusBarProps): React.JSX.Element {
  const columns = process.stdout.columns || 80;

  const keyHints = items && items.length > 0 ? <KeyHints items={items} /> : null;

  // items go in centre if left is set, otherwise in left slot
  const effectiveLeft = left ?? (!center ? keyHints : null);
  const effectiveCenter = center ?? (left ? keyHints : null);

  return (
    <Box width={columns} minHeight={1}>
      <Box flexGrow={1}>
        <Text backgroundColor={backgroundColor} color={color}>
          {effectiveLeft ?? ''}
        </Text>
      </Box>
      <Box flexGrow={1} justifyContent="center">
        <Text backgroundColor={backgroundColor} color={color}>
          {effectiveCenter ?? ''}
        </Text>
      </Box>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text backgroundColor={backgroundColor} color={color}>
          {right ?? ''}
        </Text>
      </Box>
    </Box>
  );
}
