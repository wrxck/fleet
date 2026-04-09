import React from 'react';
import { Box } from 'ink';

import { useTerminalSize } from './use-terminal-size.js';
import { ViewportContext } from './context.js';

interface ViewportProps {
  chrome?: number;
  children: React.ReactNode;
}

export function Viewport({ chrome = 0, children }: ViewportProps): React.JSX.Element {
  const { rows } = useTerminalSize();
  const available = Math.max(1, rows - chrome);

  return (
    <ViewportContext.Provider value={available}>
      <Box flexDirection="column" height={rows}>
        {children}
      </Box>
    </ViewportContext.Provider>
  );
}
