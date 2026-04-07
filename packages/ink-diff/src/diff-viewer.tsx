import React from 'react';
import { Box, Text } from 'ink';

import { diffLines, applyContext, type DiffLine } from './diff.js';

export interface DiffViewerProps {
  oldText: string;
  newText: string;
  mode?: 'unified' | 'split';
  context?: number;
  oldLabel?: string;
  newLabel?: string;
  maxHeight?: number;
}

function padNumber(n: number | undefined, width: number): string {
  if (n === undefined) return ' '.repeat(width);
  return String(n).padStart(width, ' ');
}

function UnifiedDiff({
  lines,
  oldLabel,
  newLabel,
}: {
  lines: DiffLine[];
  oldLabel?: string;
  newLabel?: string;
}) {
  const maxOldLine = Math.max(
    ...lines.map((l) => l.oldLineNo ?? 0),
    1,
  );
  const maxNewLine = Math.max(
    ...lines.map((l) => l.newLineNo ?? 0),
    1,
  );
  const oldWidth = String(maxOldLine).length;
  const newWidth = String(maxNewLine).length;

  return (
    <Box flexDirection="column">
      {(oldLabel || newLabel) && (
        <Box gap={2}>
          {oldLabel && <Text color="red">--- {oldLabel}</Text>}
          {newLabel && <Text color="green">+++ {newLabel}</Text>}
        </Box>
      )}
      {lines.map((line, i) => {
        const oldNo = padNumber(line.oldLineNo, oldWidth);
        const newNo = padNumber(line.newLineNo, newWidth);
        const gutter = `${oldNo} ${newNo}`;

        if (line.type === 'add') {
          return (
            <Box key={i}>
              <Text dimColor>{gutter} </Text>
              <Text color="green">+ {line.content}</Text>
            </Box>
          );
        }
        if (line.type === 'remove') {
          return (
            <Box key={i}>
              <Text dimColor>{gutter} </Text>
              <Text color="red">- {line.content}</Text>
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text dimColor>{gutter} </Text>
            <Text>  {line.content}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function SplitDiff({
  lines,
  oldLabel,
  newLabel,
}: {
  lines: DiffLine[];
  oldLabel?: string;
  newLabel?: string;
}) {
  // build left/right paired rows
  type Row = { left: DiffLine | null; right: DiffLine | null };
  const rows: Row[] = [];

  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.type === 'unchanged') {
      rows.push({ left: line, right: line });
      idx++;
    } else if (line.type === 'remove') {
      // check if next line is an add (paired change)
      if (idx + 1 < lines.length && lines[idx + 1].type === 'add') {
        rows.push({ left: line, right: lines[idx + 1] });
        idx += 2;
      } else {
        rows.push({ left: line, right: null });
        idx++;
      }
    } else {
      // add
      rows.push({ left: null, right: line });
      idx++;
    }
  }

  const maxOldLine = Math.max(...lines.map((l) => l.oldLineNo ?? 0), 1);
  const maxNewLine = Math.max(...lines.map((l) => l.newLineNo ?? 0), 1);
  const oldWidth = String(maxOldLine).length;
  const newWidth = String(maxNewLine).length;

  return (
    <Box flexDirection="column">
      {(oldLabel || newLabel) && (
        <Box gap={4}>
          {oldLabel && <Text color="red">{oldLabel}</Text>}
          {newLabel && <Text color="green">{newLabel}</Text>}
        </Box>
      )}
      {rows.map((row, i) => (
        <Box key={i} gap={2}>
          <Box>
            {row.left ? (
              <>
                <Text dimColor>{padNumber(row.left.oldLineNo, oldWidth)} </Text>
                <Text color={row.left.type === 'remove' ? 'red' : undefined}>
                  {row.left.content}
                </Text>
              </>
            ) : (
              <Text dimColor>{' '.repeat(oldWidth)} </Text>
            )}
          </Box>
          <Text dimColor>|</Text>
          <Box>
            {row.right ? (
              <>
                <Text dimColor>{padNumber(row.right.newLineNo, newWidth)} </Text>
                <Text color={row.right.type === 'add' ? 'green' : undefined}>
                  {row.right.content}
                </Text>
              </>
            ) : (
              <Text dimColor>{' '.repeat(newWidth)} </Text>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function DiffViewer({
  oldText,
  newText,
  mode = 'unified',
  context: contextLines = 3,
  oldLabel,
  newLabel,
  maxHeight,
}: DiffViewerProps) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let diff = diffLines(oldLines, newLines);
  diff = applyContext(diff, contextLines);

  if (maxHeight !== undefined && diff.length > maxHeight) {
    diff = diff.slice(0, maxHeight);
  }

  if (mode === 'split') {
    return <SplitDiff lines={diff} oldLabel={oldLabel} newLabel={newLabel} />;
  }

  return <UnifiedDiff lines={diff} oldLabel={oldLabel} newLabel={newLabel} />;
}
