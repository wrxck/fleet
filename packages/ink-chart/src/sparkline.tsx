import React from 'react';
import { Text } from 'ink';

import { BLOCKS } from './chars.js';

export interface SparklineProps {
  data: number[];
  width?: number;
  color?: string;
  min?: number;
  max?: number;
}

export function Sparkline({
  data,
  width,
  color = 'green',
  min: minProp,
  max: maxProp,
}: SparklineProps) {
  if (data.length === 0) {
    return <Text>{''}</Text>;
  }

  const displayWidth = width ?? data.length;

  // resample data to fit the display width
  const resampled: number[] = [];
  for (let i = 0; i < displayWidth; i++) {
    const idx = Math.floor((i / displayWidth) * data.length);
    resampled.push(data[Math.min(idx, data.length - 1)]!);
  }

  const dataMin = minProp ?? Math.min(...resampled);
  const dataMax = maxProp ?? Math.max(...resampled);
  const range = dataMax - dataMin;

  const chars = resampled.map((v) => {
    if (range === 0) return BLOCKS[4];
    const normalized = (v - dataMin) / range;
    const level = Math.round(normalized * 7);
    return BLOCKS[Math.max(0, Math.min(7, level))];
  });

  return <Text color={color}>{chars.join('')}</Text>;
}
