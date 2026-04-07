import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import { ScrollableList } from '@wrxck/ink-scrollable-list';
import { useAvailableHeight } from '@wrxck/ink-viewport';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';

import { useHealth } from '../hooks/use-health.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { colors } from '../theme.js';

export function HealthView(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { results, loading, error } = useHealth();
  const redact = useRedact();
  const availableHeight = useAvailableHeight();

  const counts = useMemo(() => ({
    healthy: results.filter(r => r.overall === 'healthy').length,
    degraded: results.filter(r => r.overall === 'degraded').length,
    down: results.filter(r => r.overall === 'down').length,
  }), [results]);

  const handler: InputHandler = (input, key) => {
    if (results.length === 0) return false;

    if (input === 'j' || key.downArrow) {
      dispatch({ type: 'SET_INDEX', view: 'health', index: Math.min(state.healthIndex + 1, results.length - 1) });
      return true;
    }
    if (input === 'k' || key.upArrow) {
      dispatch({ type: 'SET_INDEX', view: 'health', index: Math.max(state.healthIndex - 1, 0) });
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

  if (loading && results.length === 0) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Running health checks...</Text>
      </Box>
    );
  }

  if (error && results.length === 0) {
    return (
      <Box padding={1}>
        <Text color={colors.error}>Error: {error}</Text>
      </Box>
    );
  }

  const listHeight = Math.max(5, availableHeight - 4);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold>Health Monitor</Text>
        <Text color={colors.success}>{counts.healthy} healthy</Text>
        {counts.degraded > 0 && <Text color={colors.warning}>{counts.degraded} degraded</Text>}
        {counts.down > 0 && <Text color={colors.error}>{counts.down} down</Text>}
        {loading && <Text color={colors.muted}><Spinner type="dots" /></Text>}
      </Box>

      <Text bold>
        {'  APP'.padEnd(26)}{'SYSTEMD'.padEnd(12)}{'CONTAINERS'.padEnd(20)}{'HTTP'.padEnd(10)}OVERALL
      </Text>

      <ScrollableList
        items={results}
        selectedIndex={Math.min(state.healthIndex, results.length - 1)}
        maxVisible={listHeight}
        renderItem={(result, selected) => {
          const runningCount = result.containers.filter(c => c.running).length;
          const containerStr = `${runningCount}/${result.containers.length}`;
          const httpStr = result.http
            ? result.http.ok ? `${result.http.status}` : 'err'
            : 'n/a';

          return (
            <Box>
              <Text bold color={selected ? colors.primary : colors.muted}>
                {selected ? '> ' : '  '}
              </Text>
              <Text>{redact(result.app).padEnd(24)}</Text>
              <Box width={12}>
                <StatusBadge value={result.systemd.state} type="systemd" />
              </Box>
              <Text>{containerStr.padEnd(20)}</Text>
              <Box width={10}>
                <Text color={result.http?.ok ? colors.success : result.http ? colors.error : colors.muted}>
                  {httpStr}
                </Text>
              </Box>
              <StatusBadge value={result.overall} type="health" />
            </Box>
          );
        }}
      />
    </Box>
  );
}
