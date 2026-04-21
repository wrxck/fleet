import React from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { SignalKind, Signal } from '../../../core/routines/schema.js';
import { AlertsPanel } from '../components/AlertsPanel.js';
import { SignalsGrid, type SignalsGridRow } from '../components/SignalsGrid.js';
import { formatRelative } from '../format.js';

const SLICE_ONE_KINDS: SignalKind[] = ['git-clean', 'container-up', 'ci-status'];

export interface DashboardTabProps {
  rows: SignalsGridRow[];
  selectedIndex: number;
  loading: boolean;
  lastRefreshed: number;
  signalsByRepo: Map<string, Signal[]>;
  seededNotice: { seeded: number; skipped: number };
}

export function DashboardTab({
  rows,
  selectedIndex,
  loading,
  lastRefreshed,
  signalsByRepo,
  seededNotice,
}: DashboardTabProps): React.JSX.Element {
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold>Fleet dashboard</Text>
        <Text color="gray">{rows.length} repos</Text>
        {loading ? (
          <Text color="cyan"><Spinner type="dots" /> refreshing</Text>
        ) : (
          <Text color="gray">updated {formatRelative(new Date(lastRefreshed).toISOString())}</Text>
        )}
        {seededNotice.seeded > 0 && (
          <Text color="magenta">seeded {seededNotice.seeded} default routine{seededNotice.seeded === 1 ? '' : 's'}</Text>
        )}
      </Box>

      <SignalsGrid rows={rows} selectedIndex={selectedIndex} kinds={SLICE_ONE_KINDS} />

      <AlertsPanel signals={signalsByRepo} />
    </Box>
  );
}
