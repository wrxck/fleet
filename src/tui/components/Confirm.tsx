import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';
import { colors } from '../theme.js';

export function Confirm(): React.JSX.Element | null {
  const { confirmAction } = useAppState();

  if (!confirmAction) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.warning}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color={colors.warning}>{confirmAction.label}</Text>
      <Text color={colors.muted}>{confirmAction.description}</Text>
      <Box marginTop={1} gap={2}>
        <Text><Text bold color={colors.success}>y</Text> confirm</Text>
        <Text><Text bold color={colors.error}>n</Text> cancel</Text>
      </Box>
    </Box>
  );
}
