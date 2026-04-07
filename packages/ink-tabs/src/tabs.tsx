import React from 'react';
import { Box, Text } from 'ink';

export interface Tab {
  id: string;
  label: string;
  badge?: string | number;
}

export interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange?: (id: string) => void;
  accentColor?: string;
  separator?: string;
}

const BOX_VERTICAL = String.fromCharCode(0x2502);
const BOX_HORIZONTAL = String.fromCharCode(0x2500);

const DEFAULT_SEPARATOR = ` ${BOX_VERTICAL} `;

export function Tabs({
  tabs,
  activeId,
  accentColor = 'cyan',
  separator = DEFAULT_SEPARATOR,
}: TabsProps): React.ReactElement {
  return (
    <Box flexDirection="row">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        const badgeSuffix = tab.badge != null ? ` (${tab.badge})` : '';
        const underlineLen = tab.label.length + badgeSuffix.length;
        return (
          <React.Fragment key={tab.id}>
            {index > 0 && <Text dimColor>{separator}</Text>}
            <Box flexDirection="column">
              <Box>
                <Text bold={isActive} color={isActive ? accentColor : undefined} dimColor={!isActive}>
                  {tab.label}
                </Text>
                {tab.badge != null && (
                  <Text color="yellow">{badgeSuffix}</Text>
                )}
              </Box>
              {isActive && (
                <Text color={accentColor}>{BOX_HORIZONTAL.repeat(underlineLen)}</Text>
              )}
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
