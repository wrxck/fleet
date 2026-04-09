import React from 'react';
import { Box, Text } from 'ink';

export interface PagerProps {
  content: string;
  height: number;
  showLineNumbers?: boolean;
  wrap?: boolean;
  searchQuery?: string;
  scrollOffset?: number;
  onScroll?: (offset: number) => void;
}

function highlightMatches(line: string, query: string): React.ReactNode {
  if (!query) return line;

  const parts: React.ReactNode[] = [];
  let remaining = line;
  let idx = 0;

  while (remaining.length > 0) {
    const matchIndex = remaining.toLowerCase().indexOf(query.toLowerCase());
    if (matchIndex === -1) {
      parts.push(<Text key={idx}>{remaining}</Text>);
      break;
    }
    if (matchIndex > 0) {
      parts.push(<Text key={idx}>{remaining.slice(0, matchIndex)}</Text>);
      idx++;
    }
    parts.push(
      <Text key={idx} bold color="yellow">
        {remaining.slice(matchIndex, matchIndex + query.length)}
      </Text>
    );
    idx++;
    remaining = remaining.slice(matchIndex + query.length);
  }

  return <>{parts}</>;
}

function wrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];

  const wrapped: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    // try to break at a space
    let breakAt = remaining.lastIndexOf(' ', width);
    if (breakAt <= 0) breakAt = width;
    wrapped.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^ /, '');
  }
  if (remaining.length > 0) wrapped.push(remaining);
  return wrapped;
}

export function Pager({
  content,
  height,
  showLineNumbers = false,
  wrap = true,
  searchQuery,
  scrollOffset = 0,
}: PagerProps): React.JSX.Element {
  const rawLines = content.split('\n');

  const gutterWidth = showLineNumbers ? String(rawLines.length).length + 1 : 0;
  const termWidth = process.stdout.columns ?? 80;
  const contentWidth = termWidth - gutterWidth;

  const displayLines: { text: string; lineNum: number }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    if (wrap && line.length > contentWidth) {
      const wrapped = wrapLine(line, contentWidth);
      for (const w of wrapped) {
        displayLines.push({ text: w, lineNum: i + 1 });
      }
    } else {
      displayLines.push({ text: line, lineNum: i + 1 });
    }
  }

  const totalLines = displayLines.length;
  // reserve 1 row for the indicator
  const bodyHeight = height - 1;
  const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalLines - bodyHeight)));
  const visibleLines = displayLines.slice(clampedOffset, clampedOffset + bodyHeight);

  const startLine = totalLines === 0 ? 0 : clampedOffset + 1;
  const endLine = Math.min(clampedOffset + bodyHeight, totalLines);

  return (
    <Box flexDirection="column" height={height}>
      {visibleLines.map((entry, i) => (
        <Box key={i}>
          {showLineNumbers && (
            <Text dimColor>
              {String(entry.lineNum).padStart(gutterWidth - 1, ' ')}{' '}
            </Text>
          )}
          <Text>{searchQuery ? highlightMatches(entry.text, searchQuery) : entry.text}</Text>
        </Box>
      ))}
      <Box>
        <Text dimColor>
          Line {startLine}-{endLine} of {totalLines}
        </Text>
      </Box>
    </Box>
  );
}
