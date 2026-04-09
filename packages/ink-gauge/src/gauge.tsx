import React from 'react';
import { Text, Box } from 'ink';

export interface GaugeProps {
  value: number;
  width?: number;
  filledChar?: string;
  emptyChar?: string;
  color?: string;
  showPercentage?: boolean;
  label?: string;
  thresholds?: { value: number; color: string }[];
}

function resolveColor(value: number, defaultColor: string, thresholds?: { value: number; color: string }[]): string {
  if (!thresholds || thresholds.length === 0) return defaultColor;
  const sorted = [...thresholds].sort((a, b) => a.value - b.value);
  let color = defaultColor;
  for (const t of sorted) {
    if (value >= t.value) {
      color = t.color;
    }
  }
  return color;
}

export function Gauge({
  value,
  width = 20,
  filledChar = '\u2588',
  emptyChar = '\u2591',
  color = 'green',
  showPercentage = true,
  label,
  thresholds,
}: GaugeProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const resolvedColor = resolveColor(clamped, color, thresholds);

  return (
    <Box>
      {label && <Text>{label} </Text>}
      <Text>[</Text>
      <Text color={resolvedColor}>{filledChar.repeat(filled)}</Text>
      <Text>{emptyChar.repeat(empty)}</Text>
      <Text>]</Text>
      {showPercentage && <Text> {Math.round(clamped)}%</Text>}
    </Box>
  );
}
