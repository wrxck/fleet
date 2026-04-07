import React from 'react';
import { Box, Text } from 'ink';

export interface ModalProps {
  visible: boolean;
  title?: string;
  width?: number;
  borderColor?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({
  visible,
  title,
  width = 50,
  borderColor = 'cyan',
  children,
  footer,
}: ModalProps): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <Box alignItems="center" width="100%">
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
      >
        {title != null && (
          <Box marginBottom={1}>
            <Text bold>{title}</Text>
          </Box>
        )}
        <Box flexDirection="column">{children}</Box>
        {footer != null && (
          <Box marginTop={1}>
            <Text dimColor>{footer}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
