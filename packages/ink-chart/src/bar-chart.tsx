import React from 'react';
import { Text, Box } from 'ink';

import { FULL_BLOCK } from './chars.js';

export interface BarChartDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarChartDatum[];
  height?: number;
  width?: number;
  showValues?: boolean;
}

export function BarChart({
  data,
  height = 10,
  showValues = true,
}: BarChartProps) {
  if (data.length === 0) {
    return <Text>{''}</Text>;
  }

  const maxValue = Math.max(...data.map((d) => d.value));

  // build rows from top to bottom
  const rows: React.ReactNode[] = [];

  // value row
  if (showValues) {
    const valueParts: React.ReactNode[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i > 0) valueParts.push(<Text key={`vs-${i}`}> </Text>);
      const valStr = String(data[i]!.value);
      valueParts.push(
        <Text key={`v-${i}`} color={data[i]!.color ?? 'green'}>
          {valStr}
        </Text>,
      );
    }
    rows.push(
      <Box key="values">
        {valueParts}
      </Box>,
    );
  }

  // bar rows (top to bottom)
  for (let row = height; row >= 1; row--) {
    const parts: React.ReactNode[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i > 0) parts.push(<Text key={`s-${row}-${i}`}> </Text>);
      const d = data[i]!;
      const barHeight = maxValue === 0 ? 0 : (d.value / maxValue) * height;
      if (barHeight >= row) {
        parts.push(
          <Text key={`b-${row}-${i}`} color={d.color ?? 'green'}>
            {FULL_BLOCK}
          </Text>,
        );
      } else {
        parts.push(<Text key={`b-${row}-${i}`}>{' '}</Text>);
      }
    }
    rows.push(
      <Box key={`row-${row}`}>
        {parts}
      </Box>,
    );
  }

  // label row
  const labelParts: React.ReactNode[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i > 0) labelParts.push(<Text key={`ls-${i}`}> </Text>);
    labelParts.push(
      <Text key={`l-${i}`}>{data[i]!.label}</Text>,
    );
  }
  rows.push(
    <Box key="labels">
      {labelParts}
    </Box>,
  );

  return (
    <Box flexDirection="column">
      {rows}
    </Box>
  );
}
