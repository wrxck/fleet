import React from 'react';
import { Box, Text } from 'ink';

const DEFAULT_CHAR = '\u2500';

export interface RuleProps {
  title?: string;
  char?: string;
  color?: string;
  width?: number;
}

export function Rule({ title, char = DEFAULT_CHAR, color = 'grey', width }: RuleProps): React.ReactElement {
  if (width) {
    // explicit width: render a fixed-width rule
    if (title) {
      const label = ` ${title} `;
      const remaining = Math.max(0, width - label.length);
      const left = Math.ceil(remaining / 2);
      const right = Math.floor(remaining / 2);

      return (
        <Text>
          <Text color={color}>{char.repeat(left)}</Text>
          <Text bold>{label}</Text>
          <Text color={color}>{char.repeat(right)}</Text>
        </Text>
      );
    }

    return <Text color={color}>{char.repeat(width)}</Text>;
  }

  // no explicit width: use flexbox to fill available space, respecting parent padding
  if (title) {
    const label = ` ${title} `;
    return (
      <Box>
        <Text color={color} wrap="truncate">{char.repeat(999)}</Text>
        <Text bold>{label}</Text>
        <Text color={color} wrap="truncate">{char.repeat(999)}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={color} wrap="truncate">{char.repeat(999)}</Text>
    </Box>
  );
}
