import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

export interface Column<T> {
  key: keyof T & string;
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

export interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  selectedIndex?: number;
  maxVisible?: number;
  emptyText?: string;
  borderStyle?: 'single' | 'none';
}

const MAX_AUTO_WIDTH = 30;

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return '\u2026';
  return text.slice(0, width - 1) + '\u2026';
}

function padCell(text: string, width: number, align: 'left' | 'right' | 'center'): string {
  const truncated = truncate(text, width);
  const padding = width - truncated.length;
  if (padding <= 0) return truncated;

  if (align === 'right') {
    return ' '.repeat(padding) + truncated;
  }
  if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + truncated + ' '.repeat(right);
  }
  return truncated + ' '.repeat(padding);
}

export function Table<T>({
  data,
  columns,
  selectedIndex,
  maxVisible,
  emptyText = 'No data',
  borderStyle = 'single',
}: TableProps<T>): React.JSX.Element {
  const resolvedWidths = useMemo(() => {
    return columns.map((col) => {
      if (col.width !== undefined) return col.width;
      let max = col.header.length;
      for (const row of data) {
        const len = cellToString(row[col.key]).length;
        if (len > max) max = len;
      }
      return Math.min(max, MAX_AUTO_WIDTH);
    });
  }, [columns, data]);

  const separator = borderStyle === 'single' ? ' \u2502 ' : '  ';

  const headerCells = columns.map((col, i) =>
    padCell(col.header, resolvedWidths[i]!, col.align ?? 'left'),
  );
  const headerLine = headerCells.join(separator);

  const dividerLine = useMemo(() => {
    if (borderStyle !== 'single') return null;
    const segments = resolvedWidths.map((w) => '\u2500'.repeat(w));
    return segments.join('\u2500\u253C\u2500');
  }, [resolvedWidths, borderStyle]);

  const { visibleRows, scrollOffset, hasAbove, hasBelow } = useMemo(() => {
    if (data.length === 0) {
      return { visibleRows: [] as T[], scrollOffset: 0, hasAbove: false, hasBelow: false };
    }

    if (maxVisible === undefined || maxVisible >= data.length) {
      return { visibleRows: data, scrollOffset: 0, hasAbove: false, hasBelow: false };
    }

    const idx = selectedIndex !== undefined ? Math.min(selectedIndex, data.length - 1) : 0;
    const displayRows = Math.min(maxVisible, data.length);

    let offset = 0;
    if (idx >= offset + displayRows) {
      offset = idx - displayRows + 1;
    }
    if (idx < offset) {
      offset = idx;
    }
    offset = Math.max(0, Math.min(offset, data.length - displayRows));

    return {
      visibleRows: data.slice(offset, offset + displayRows),
      scrollOffset: offset,
      hasAbove: offset > 0,
      hasBelow: offset + displayRows < data.length,
    };
  }, [data, selectedIndex, maxVisible]);

  if (data.length === 0) {
    return <Text dimColor>{emptyText}</Text>;
  }

  const renderRow = (row: T, actualIndex: number) => {
    const isSelected = selectedIndex !== undefined && actualIndex === selectedIndex;
    const cells = columns.map((col, i) => {
      if (col.render) {
        return col.render(row[col.key], row);
      }
      const text = cellToString(row[col.key]);
      return padCell(text, resolvedWidths[i]!, col.align ?? 'left');
    });
    const line = cells.join(separator);

    if (isSelected) {
      return (
        <Text bold color="cyan">
          {line}
        </Text>
      );
    }
    return <Text>{line}</Text>;
  };

  return (
    <Box flexDirection="column">
      <Text bold>{headerLine}</Text>
      {dividerLine !== null && <Text dimColor>{dividerLine}</Text>}
      {hasAbove && (
        <Text dimColor>  {'\u2191'} {scrollOffset} more above</Text>
      )}
      {visibleRows.map((row, i) => {
        const actualIndex = scrollOffset + i;
        return (
          <Box key={actualIndex}>
            {renderRow(row, actualIndex)}
          </Box>
        );
      })}
      {hasBelow && (
        <Text dimColor>  {'\u2193'} {data.length - scrollOffset - visibleRows.length} more below</Text>
      )}
    </Box>
  );
}
