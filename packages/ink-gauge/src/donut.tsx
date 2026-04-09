import React from 'react';
import { Text, Box } from 'ink';

export interface DonutProps {
  value: number;
  label?: string;
  color?: string;
  size?: 'small' | 'large';
}

export function Donut({
  value,
  label,
  color = 'green',
  size = 'small',
}: DonutProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value));
  const pct = Math.round(clamped);

  if (size === 'large') {
    const pctStr = `${pct}%`;
    const inner = pctStr.length;
    const dash = '\u2500'.repeat(inner);
    return (
      <Box flexDirection="column">
        <Text>  <Text color={color}>{'\u256D'}{dash}{'\u256E'}</Text></Text>
        <Text>  <Text color={color}>{'\u2502'}</Text>{pctStr}<Text color={color}>{'\u2502'}</Text></Text>
        <Text>  <Text color={color}>{'\u2570'}{dash}{'\u256F'}</Text></Text>
      </Box>
    );
  }

  // small mode
  const width = 10;
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const filledChar = '\u25CF';
  const emptyChar = '\u25CB';

  const displayLabel = label ?? `${pct}%`;

  return (
    <Box>
      <Text>[</Text>
      <Text color={color}>{filledChar.repeat(filled)}</Text>
      <Text>{emptyChar.repeat(empty)}</Text>
      <Text>] </Text>
      <Text>{displayLabel}</Text>
    </Box>
  );
}
