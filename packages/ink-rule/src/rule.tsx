import React from 'react';
import { Text } from 'ink';

const DEFAULT_CHAR = '\u2500';

export interface RuleProps {
  title?: string;
  char?: string;
  color?: string;
  width?: number;
}

export function Rule({ title, char = DEFAULT_CHAR, color = 'grey', width }: RuleProps): React.ReactElement {
  const totalWidth = width ?? process.stdout.columns ?? 80;

  if (title) {
    const label = ` ${title} `;
    const remaining = Math.max(0, totalWidth - label.length);
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

  return (
    <Text color={color}>{char.repeat(totalWidth)}</Text>
  );
}
