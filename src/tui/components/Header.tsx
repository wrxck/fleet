import React from 'react';
import { Box, Text } from 'ink';
import { Tabs } from '@matthesketh/ink-tabs';
import { Breadcrumb } from '@matthesketh/ink-breadcrumb';

import { useAppState } from '../state.js';
import { colors } from '../theme.js';
import type { View } from '../types.js';

const TAB_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'health', label: 'Health' },
  { id: 'secrets', label: 'Secrets' },
];

const TOP_VIEWS = new Set<View>(['dashboard', 'health', 'secrets']);

function resolveActiveTab(view: View, previousView: View | null): string {
  if (TOP_VIEWS.has(view)) return view;
  if (view === 'app-detail' || view === 'logs') return 'dashboard';
  if (view === 'secret-edit') return 'secrets';
  return previousView ?? 'dashboard';
}

function buildBreadcrumb(view: View, selectedApp: string | null): string[] {
  switch (view) {
    case 'dashboard':
      return ['Dashboard'];
    case 'health':
      return ['Health'];
    case 'secrets':
      return ['Secrets'];
    case 'app-detail':
      return ['Dashboard', selectedApp ?? '...'];
    case 'logs':
      return ['Dashboard', selectedApp ?? '...', 'Logs'];
    case 'secret-edit':
      return ['Secrets', selectedApp ?? '...', 'Edit'];
    default:
      return ['Dashboard'];
  }
}

interface HeaderProps {
  vaultSealed: boolean;
}

export function Header({ vaultSealed }: HeaderProps): React.JSX.Element {
  const { currentView, previousView, selectedApp, redacted } = useAppState();
  const activeTab = resolveActiveTab(currentView, previousView);
  const breadcrumb = buildBreadcrumb(currentView, selectedApp);

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderBottom paddingX={1} justifyContent="space-between">
        <Box gap={1} alignItems="center">
          <Text bold color={colors.primary}>Fleet</Text>
          <Tabs tabs={TAB_ITEMS} activeId={activeTab} accentColor={colors.primary} />
        </Box>
        <Box gap={1}>
          {redacted && <Text color="magenta" bold>[REDACTED]</Text>}
          <Text color={vaultSealed ? colors.warning : colors.success}>
            {vaultSealed ? '[SEALED]' : '[UNSEALED]'}
          </Text>
        </Box>
      </Box>
      {breadcrumb.length > 1 && (
        <Box paddingX={1}>
          <Breadcrumb path={breadcrumb} activeColor={colors.primary} />
        </Box>
      )}
    </Box>
  );
}
