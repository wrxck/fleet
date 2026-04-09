import React from 'react';
import { Text, Box } from 'ink';

import {
  BOX_VERTICAL,
  BOX_UP_RIGHT,
  BOX_HORIZONTAL,
  BOX_DIAGONAL_UP,
  BOX_DIAGONAL_DOWN,
  MIDDLE_DOT,
} from './chars.js';

export interface LineChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showAxis?: boolean;
  label?: string;
}

export function LineChart({
  data,
  width = 40,
  height = 10,
  color = 'cyan',
  showAxis = true,
  label,
}: LineChartProps) {
  if (data.length === 0) {
    return <Text>{''}</Text>;
  }

  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);
  const range = dataMax - dataMin || 1;

  // resample data to width
  const resampled: number[] = [];
  for (let i = 0; i < width; i++) {
    const idx = Math.floor((i / width) * data.length);
    resampled.push(data[Math.min(idx, data.length - 1)]!);
  }

  // map values to row positions (0 = bottom, height-1 = top)
  const positions = resampled.map((v) =>
    Math.round(((v - dataMin) / range) * (height - 1)),
  );

  // build the grid
  const rows: string[] = [];
  const axisLabelWidth = showAxis
    ? Math.max(
        String(Math.round(dataMax)).length,
        String(Math.round(dataMin)).length,
        (label ?? '').length,
      ) + 1
    : 0;

  for (let row = height - 1; row >= 0; row--) {
    let line = '';

    if (showAxis) {
      if (row === height - 1) {
        line += String(Math.round(dataMax)).padStart(axisLabelWidth) + BOX_VERTICAL;
      } else if (row === 0) {
        line += String(Math.round(dataMin)).padStart(axisLabelWidth) + BOX_VERTICAL;
      } else {
        line += ' '.repeat(axisLabelWidth) + BOX_VERTICAL;
      }
    }

    for (let col = 0; col < width; col++) {
      const pos = positions[col]!;
      if (pos === row) {
        // determine character based on slope
        if (col === 0 || col === width - 1) {
          line += MIDDLE_DOT;
        } else {
          const prev = positions[col - 1]!;
          const next = positions[col + 1]!;
          if (prev < pos && next < pos) {
            line += MIDDLE_DOT;
          } else if (prev > pos && next > pos) {
            line += MIDDLE_DOT;
          } else if ((prev < pos && next >= pos) || (next < pos && prev >= pos)) {
            line += BOX_DIAGONAL_UP;
          } else if ((prev > pos && next <= pos) || (next > pos && prev <= pos)) {
            line += BOX_DIAGONAL_DOWN;
          } else {
            line += BOX_HORIZONTAL;
          }
        }
      } else {
        line += ' ';
      }
    }

    rows.push(line);
  }

  // x-axis
  if (showAxis) {
    rows.push(' '.repeat(axisLabelWidth) + BOX_UP_RIGHT + BOX_HORIZONTAL.repeat(width));
  }

  const output = rows.join('\n');

  return (
    <Box flexDirection="column">
      {label && showAxis ? <Text>{' '.repeat(axisLabelWidth) + ' ' + label}</Text> : null}
      <Text color={color}>{output}</Text>
    </Box>
  );
}
