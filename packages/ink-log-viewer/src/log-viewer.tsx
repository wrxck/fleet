import React from 'react';
import { Text, Box } from 'ink';

export interface LogLine {
  text: string;
  timestamp?: Date;
  level?: 'info' | 'warn' | 'error' | 'debug';
}

export interface LogViewerProps {
  lines: LogLine[];
  height: number;
  showTimestamps?: boolean;
  showLevel?: boolean;
  filter?: string;
  autoScroll?: boolean;
  wrap?: boolean;
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function LevelBadge({ level }: { level: LogLine['level'] }) {
  switch (level) {
    case 'info':
      return <Text color="blue">INFO </Text>;
    case 'warn':
      return <Text color="yellow">WARN </Text>;
    case 'error':
      return <Text color="red">ERR  </Text>;
    case 'debug':
      return <Text dimColor>DBG  </Text>;
    default:
      return null;
  }
}

export function LogViewer({
  lines,
  height,
  showTimestamps = false,
  showLevel = false,
  filter,
  autoScroll = true,
  wrap = true,
}: LogViewerProps) {
  let visible = lines;

  if (filter) {
    const lower = filter.toLowerCase();
    visible = visible.filter((line) => line.text.toLowerCase().includes(lower));
  }

  if (autoScroll) {
    visible = visible.slice(-height);
  } else {
    visible = visible.slice(0, height);
  }

  return (
    <Box flexDirection="column" height={height}>
      {visible.map((line, i) => (
        <Box key={i} flexDirection="row">
          {showTimestamps && line.timestamp && (
            <Text dimColor>{formatTime(line.timestamp)} </Text>
          )}
          {showLevel && line.level && <LevelBadge level={line.level} />}
          <Text wrap={wrap ? 'wrap' : 'truncate'}>{line.text}</Text>
        </Box>
      ))}
    </Box>
  );
}
