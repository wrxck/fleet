import React, { useContext } from 'react';
import { Box, Text } from 'ink';

import { ToastContext } from './context.js';
import type { Toast } from './context.js';

const icons: Record<Toast['type'], string> = {
  success: '\u2713',
  error: '\u2717',
  info: '\u2139',
  warning: '\u26A0',
};

const colors: Record<Toast['type'], string> = {
  success: 'green',
  error: 'red',
  info: 'blue',
  warning: 'yellow',
};

export function ToastContainer(): React.JSX.Element | null {
  const ctx = useContext(ToastContext);
  if (!ctx || ctx.toasts.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {ctx.toasts.map(toast => (
        <Text key={toast.id} color={colors[toast.type]}>
          {icons[toast.type]} {toast.message}
        </Text>
      ))}
    </Box>
  );
}
