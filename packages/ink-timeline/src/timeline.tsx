import React from 'react';
import { Box, Text } from 'ink';

export interface TimelineEvent {
  time: string | Date;
  type?: string;
  typeColor?: string;
  title: string;
  description?: string;
}

export interface TimelineProps {
  events: TimelineEvent[];
  maxVisible?: number;
  showRelativeTime?: boolean;
}

const AUTO_COLOURS: Record<string, string> = {
  deploy: 'green',
  restart: 'yellow',
  alert: 'red',
  error: 'red',
  info: 'blue',
};

const CHAR_DOT = String.fromCodePoint(0x25CF);
const CHAR_PIPE = String.fromCodePoint(0x2502);
const CHAR_ARROW_UP = String.fromCodePoint(0x25B2);
const CHAR_ARROW_DOWN = String.fromCodePoint(0x25BC);

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatTime(time: string | Date, relative: boolean): string {
  if (relative) {
    const date = typeof time === 'string' ? new Date(time) : time;
    return formatRelativeTime(date);
  }
  if (typeof time === 'string') return time;
  return time.toLocaleTimeString();
}

function resolveColour(type?: string, typeColor?: string): string {
  if (typeColor) return typeColor;
  if (type) return AUTO_COLOURS[type.toLowerCase()] ?? 'white';
  return 'white';
}

const SPACER = '            ';

export function Timeline({ events, maxVisible, showRelativeTime = false }: TimelineProps): React.ReactElement {
  // newest first
  const sorted = [...events].sort((a, b) => {
    const ta = typeof a.time === 'string' ? new Date(a.time).getTime() : a.time.getTime();
    const tb = typeof b.time === 'string' ? new Date(b.time).getTime() : b.time.getTime();
    return tb - ta;
  });

  const hasMore = maxVisible != null && sorted.length > maxVisible;
  const visible = maxVisible != null ? sorted.slice(0, maxVisible) : sorted;
  const hiddenCount = hasMore ? sorted.length - maxVisible! : 0;

  return (
    <Box flexDirection="column">
      {hasMore && (
        <Text dimColor>{'  ' + CHAR_ARROW_UP + ' newer events above'}</Text>
      )}
      {visible.map((event, idx) => {
        const isLast = idx === visible.length - 1 && !hasMore;
        const colour = resolveColour(event.type, event.typeColor);
        const timestamp = formatTime(event.time, showRelativeTime);

        return (
          <Box key={idx} flexDirection="column">
            <Box>
              <Text dimColor>{timestamp.padEnd(12)}</Text>
              <Text>{CHAR_DOT}</Text>
              <Text> </Text>
              {event.type && (
                <>
                  <Text color={colour}>[{event.type.toUpperCase()}]</Text>
                  <Text> </Text>
                </>
              )}
              <Text>{event.title}</Text>
            </Box>
            {event.description && (
              <Box>
                <Text dimColor>{SPACER}</Text>
                <Text>{CHAR_PIPE}</Text>
                <Text> </Text>
                <Text dimColor>{event.description}</Text>
              </Box>
            )}
            {!isLast && (
              <Box>
                <Text dimColor>{SPACER}</Text>
                <Text>{CHAR_PIPE}</Text>
              </Box>
            )}
          </Box>
        );
      })}
      {hasMore && (
        <Text dimColor>{'  ' + CHAR_ARROW_DOWN + ' ' + hiddenCount + ' more events below'}</Text>
      )}
    </Box>
  );
}
