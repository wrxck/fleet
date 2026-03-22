import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';
import { colors } from '../theme.js';
import type { View } from '../types.js';

const TABS: Array<{ view: View; label: string }> = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'health', label: 'Health' },
  { view: 'secrets', label: 'Secrets' },
];

interface VaultIndicatorProps {
  sealed: boolean;
}

function VaultIndicator({ sealed }: VaultIndicatorProps): React.JSX.Element {
  return (
    <Text color={sealed ? colors.warning : colors.success}>
      {sealed ? '[SEALED]' : '[UNSEALED]'}
    </Text>
  );
}

interface HeaderProps {
  vaultSealed: boolean;
}

export function Header({ vaultSealed }: HeaderProps): React.JSX.Element {
  const { currentView, redacted } = useAppState();

  return (
    <Box borderStyle="single" borderBottom paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text bold color={colors.primary}>Fleet</Text>
        <Text color={colors.muted}>|</Text>
        {TABS.map(tab => (
          <Text
            key={tab.view}
            bold={currentView === tab.view || currentView === 'app-detail' && tab.view === 'dashboard' || currentView === 'secret-edit' && tab.view === 'secrets' || currentView === 'logs' && tab.view === 'dashboard'}
            color={currentView === tab.view ? colors.primary : colors.muted}
          >
            {tab.label}
          </Text>
        ))}
      </Box>
      <Box gap={1}>
        {redacted && <Text color="magenta" bold>[REDACTED]</Text>}
        <VaultIndicator sealed={vaultSealed} />
      </Box>
    </Box>
  );
}
