import React, { useState, useCallback, useMemo } from 'react';

import { Box, Text, useInput } from 'ink';

export interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  height?: number;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
}

export function TextArea({
  value,
  onChange,
  onSubmit,
  height = 5,
  placeholder,
  focus = true,
  showCursor = true,
}: TextAreaProps): React.ReactElement {
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 0, col: 0 });
  const [scrollOffset, setScrollOffset] = useState(0);

  const lines = useMemo(() => {
    const split = value.split('\n');
    return split;
  }, [value]);

  const updateScroll = useCallback(
    (cursorLine: number, currentOffset: number) => {
      let newOffset = currentOffset;
      if (cursorLine < currentOffset) {
        newOffset = cursorLine;
      } else if (cursorLine >= currentOffset + height) {
        newOffset = cursorLine - height + 1;
      }
      if (newOffset !== currentOffset) {
        setScrollOffset(newOffset);
      }
      return newOffset;
    },
    [height],
  );

  const clampCol = useCallback((col: number, lineLength: number) => {
    return Math.min(col, lineLength);
  }, []);

  useInput(
    (input, key) => {
      if (!focus) return;

      // ctrl+enter or ctrl+s -> submit
      if ((key.return && key.ctrl) || (input === 's' && key.ctrl)) {
        onSubmit?.(value);
        return;
      }

      // enter -> newline
      if (key.return) {
        const currentLine = lines[cursor.line] ?? '';
        const before = currentLine.slice(0, cursor.col);
        const after = currentLine.slice(cursor.col);
        const newLines = [...lines];
        newLines.splice(cursor.line, 1, before, after);
        const newValue = newLines.join('\n');
        const newCursorLine = cursor.line + 1;
        onChange(newValue);
        setCursor({ line: newCursorLine, col: 0 });
        updateScroll(newCursorLine, scrollOffset);
        return;
      }

      // backspace
      if (key.backspace || key.delete) {
        if (cursor.col > 0) {
          const currentLine = lines[cursor.line] ?? '';
          const newLine = currentLine.slice(0, cursor.col - 1) + currentLine.slice(cursor.col);
          const newLines = [...lines];
          newLines[cursor.line] = newLine;
          onChange(newLines.join('\n'));
          setCursor({ line: cursor.line, col: cursor.col - 1 });
        } else if (cursor.line > 0) {
          // merge with previous line
          const prevLine = lines[cursor.line - 1] ?? '';
          const currentLine = lines[cursor.line] ?? '';
          const newCol = prevLine.length;
          const newLines = [...lines];
          newLines.splice(cursor.line - 1, 2, prevLine + currentLine);
          const newCursorLine = cursor.line - 1;
          onChange(newLines.join('\n'));
          setCursor({ line: newCursorLine, col: newCol });
          updateScroll(newCursorLine, scrollOffset);
        }
        return;
      }

      // arrow keys
      if (key.leftArrow) {
        if (cursor.col > 0) {
          setCursor({ line: cursor.line, col: cursor.col - 1 });
        } else if (cursor.line > 0) {
          const prevLineLength = (lines[cursor.line - 1] ?? '').length;
          const newCursorLine = cursor.line - 1;
          setCursor({ line: newCursorLine, col: prevLineLength });
          updateScroll(newCursorLine, scrollOffset);
        }
        return;
      }

      if (key.rightArrow) {
        const currentLineLength = (lines[cursor.line] ?? '').length;
        if (cursor.col < currentLineLength) {
          setCursor({ line: cursor.line, col: cursor.col + 1 });
        } else if (cursor.line < lines.length - 1) {
          const newCursorLine = cursor.line + 1;
          setCursor({ line: newCursorLine, col: 0 });
          updateScroll(newCursorLine, scrollOffset);
        }
        return;
      }

      if (key.upArrow) {
        if (cursor.line > 0) {
          const newCursorLine = cursor.line - 1;
          const newCol = clampCol(cursor.col, (lines[newCursorLine] ?? '').length);
          setCursor({ line: newCursorLine, col: newCol });
          updateScroll(newCursorLine, scrollOffset);
        }
        return;
      }

      if (key.downArrow) {
        if (cursor.line < lines.length - 1) {
          const newCursorLine = cursor.line + 1;
          const newCol = clampCol(cursor.col, (lines[newCursorLine] ?? '').length);
          setCursor({ line: newCursorLine, col: newCol });
          updateScroll(newCursorLine, scrollOffset);
        }
        return;
      }

      // tab
      if (key.tab) {
        const currentLine = lines[cursor.line] ?? '';
        const newLine = currentLine.slice(0, cursor.col) + '  ' + currentLine.slice(cursor.col);
        const newLines = [...lines];
        newLines[cursor.line] = newLine;
        onChange(newLines.join('\n'));
        setCursor({ line: cursor.line, col: cursor.col + 2 });
        return;
      }

      // regular character input
      if (input && !key.ctrl && !key.meta) {
        const currentLine = lines[cursor.line] ?? '';
        const newLine = currentLine.slice(0, cursor.col) + input + currentLine.slice(cursor.col);
        const newLines = [...lines];
        newLines[cursor.line] = newLine;
        onChange(newLines.join('\n'));
        setCursor({ line: cursor.line, col: cursor.col + input.length });
      }
    },
    { isActive: focus },
  );

  if (value === '' && placeholder) {
    return (
      <Box flexDirection="column" height={height}>
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  const visibleLines = lines.slice(scrollOffset, scrollOffset + height);

  const renderedLines = visibleLines.map((line, i) => {
    const absoluteLineIndex = scrollOffset + i;
    const isCursorLine = absoluteLineIndex === cursor.line;

    if (isCursorLine && showCursor && focus) {
      const col = cursor.col;
      const before = line.slice(0, col);
      const cursorChar = line[col] ?? ' ';
      const after = line.slice(col + 1);

      return (
        <Text key={absoluteLineIndex}>
          {before}
          <Text inverse>{cursorChar}</Text>
          {after}
        </Text>
      );
    }

    return <Text key={absoluteLineIndex}>{line || ' '}</Text>;
  });

  const padCount = height - visibleLines.length;
  for (let i = 0; i < padCount; i++) {
    renderedLines.push(<Text key={`pad-${i}`}>{' '}</Text>);
  }

  return <Box flexDirection="column">{renderedLines}</Box>;
}
