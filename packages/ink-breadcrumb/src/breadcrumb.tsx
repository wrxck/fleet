import React from 'react';
import { Text, Box } from 'ink';

export interface BreadcrumbProps {
  path: string[];
  separator?: string;
  activeColor?: string;
  inactiveColor?: string;
}

export function Breadcrumb({
  path,
  separator = ' \u203a ',
  activeColor = 'cyan',
  inactiveColor = 'gray',
}: BreadcrumbProps): React.ReactNode {
  if (path.length === 0) {
    return null;
  }

  const lastIndex = path.length - 1;

  return (
    <Box>
      {path.map((segment, index) => {
        const isLast = index === lastIndex;
        return (
          <React.Fragment key={index}>
            {index > 0 && <Text dimColor>{separator}</Text>}
            {isLast ? (
              <Text bold color={activeColor}>{segment}</Text>
            ) : (
              <Text color={inactiveColor}>{segment}</Text>
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
