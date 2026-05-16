import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import { ScrollableList } from '@matthesketh/ink-scrollable-list';
import { useAvailableHeight } from '@matthesketh/ink-viewport';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

import { useAppState, useAppDispatch, redactName } from '../state';
import { useFleetData } from '../hooks/use-fleet-data';
import { colors } from '../theme';

export function Dashboard(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { status, loading, error } = useFleetData();
  const availableHeight = useAvailableHeight();

  const items = useMemo(
    () => (status?.apps ?? []).map(app => ({
      ...app,
      // bake the redacted label onto the item: ScrollableList memoises rows by
      // item identity, so a redaction toggle must yield fresh item objects.
      displayLabel: state.redacted ? redactName(app.name) : app.name,
    })),
    [status, state.redacted],
  );

  const handler: InputHandler = (input, key) => {
    if (items.length === 0) return false;

    if (input === 'j' || key.downArrow) {
      dispatch({ type: 'SET_INDEX', view: 'dashboard', index: Math.min(state.dashboardIndex + 1, items.length - 1) });
      return true;
    }
    if (input === 'k' || key.upArrow) {
      dispatch({ type: 'SET_INDEX', view: 'dashboard', index: Math.max(state.dashboardIndex - 1, 0) });
      return true;
    }
    if (key.return) {
      const item = items[state.dashboardIndex];
      if (item) {
        dispatch({ type: 'SELECT_APP', app: item.name });
        dispatch({ type: 'NAVIGATE', view: 'app-detail' });
      }
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  if (loading && !status) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Loading fleet status...</Text>
      </Box>
    );
  }

  if (error && !status) {
    return (
      <Box padding={1}>
        <Text color={colors.error}>Error: {error}</Text>
      </Box>
    );
  }

  if (!status) return <Text color={colors.muted}>No data</Text>;

  const listHeight = Math.max(5, availableHeight - 4);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold>{status.totalApps} apps</Text>
        <Text color={colors.success}>{status.healthy} healthy</Text>
        {status.unhealthy > 0 && (
          <Text color={colors.error}>{status.unhealthy} unhealthy</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text bold>{'APP'.padEnd(24)}{'SYSTEMD'.padEnd(14)}{'CONTAINERS'.padEnd(14)}{'HEALTH'.padEnd(12)}</Text>
      </Box>

      <ScrollableList
        items={items}
        selectedIndex={Math.min(state.dashboardIndex, items.length - 1)}
        maxVisible={listHeight}
        renderItem={(item, selected) => {
          const label = item.displayLabel;
          return (
            <Box>
              <Text bold color={selected ? colors.primary : colors.muted}>
                {selected ? '> ' : '  '}
              </Text>
              <Box width={24}>
                <Text bold={selected} color={selected ? colors.primary : colors.text}>
                  {label.length > 22 ? label.slice(0, 19) + '...' : label}
                </Text>
              </Box>
              <Box width={14}>
                <Text>{item.systemd.slice(0, 12)}</Text>
              </Box>
              <Box width={14}>
                <Text>{item.containers}</Text>
              </Box>
              <Box width={12}>
                <Text>{item.health.slice(0, 10)}</Text>
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
}
