import React from 'react';
import { Box, Text } from 'ink';

export interface SplitPaneProps {
  direction?: 'horizontal' | 'vertical';
  sizes?: [number, number];
  minSize?: number;
  showDivider?: boolean;
  dividerChar?: string;
  dividerColor?: string;
  children: [React.ReactNode, React.ReactNode];
}

export function SplitPane({
  direction = 'horizontal',
  sizes = [50, 50],
  minSize = 5,
  showDivider = true,
  dividerChar,
  dividerColor = 'gray',
  children,
}: SplitPaneProps): React.ReactElement {
  const isHorizontal = direction === 'horizontal';
  const char = dividerChar ?? (isHorizontal ? '\u2502' : '\u2500');

  const totalColumns = process.stdout.columns || 80;
  const totalRows = process.stdout.rows || 24;

  const totalSize = isHorizontal ? totalColumns : totalRows;
  const dividerSize = showDivider ? 1 : 0;
  const available = totalSize - dividerSize;

  const ratio1 = sizes[0] / (sizes[0] + sizes[1]);
  let size1 = Math.round(available * ratio1);
  let size2 = available - size1;

  // enforce min size
  if (size1 < minSize) {
    size1 = minSize;
    size2 = available - size1;
  }
  if (size2 < minSize) {
    size2 = minSize;
    size1 = available - size2;
  }

  if (isHorizontal) {
    return (
      <Box flexDirection="row" width={totalColumns}>
        <Box width={size1} borderRight={showDivider} borderColor={dividerColor} overflow="hidden">
          {children[0]}
        </Box>
        <Box width={size2} overflow="hidden">
          {children[1]}
        </Box>
      </Box>
    );
  }

  // vertical layout
  return (
    <Box flexDirection="column" height={totalRows}>
      <Box height={size1} overflow="hidden">
        {children[0]}
      </Box>
      {showDivider && (
        <Box width={totalColumns} height={1}>
          <Text color={dividerColor}>
            {char.repeat(totalColumns)}
          </Text>
        </Box>
      )}
      <Box height={size2} overflow="hidden">
        {children[1]}
      </Box>
    </Box>
  );
}
