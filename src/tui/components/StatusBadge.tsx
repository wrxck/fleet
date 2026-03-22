import React from 'react';
import { Text } from 'ink';
import { statusColor, healthColor } from '../theme.js';

interface StatusBadgeProps {
  value: string;
  type?: 'systemd' | 'health';
}

export function StatusBadge({ value, type = 'health' }: StatusBadgeProps): React.JSX.Element {
  const colorMap = type === 'systemd' ? statusColor : healthColor;
  const color = colorMap[value] ?? 'gray';

  return <Text color={color}>{value}</Text>;
}
