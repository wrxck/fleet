import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useAppDispatch, useRedact } from '../state.js';
import { useFleetData } from '../hooks/use-fleet-data.js';
import { AppList } from '../components/AppList.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { colors } from '../theme.js';

export function Dashboard(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const { status, loading, error } = useFleetData();
  const redact = useRedact();

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

  const items = status.apps.map(app => ({ ...app, name: app.name }));

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold>{status.totalApps} apps</Text>
        <Text color={colors.success}>{status.healthy} healthy</Text>
        {status.unhealthy > 0 && (
          <Text color={colors.error}>{status.unhealthy} unhealthy</Text>
        )}
        {loading && <Text color={colors.muted}><Spinner type="dots" /></Text>}
      </Box>

      <Box marginBottom={1}>
        <Text bold>  {'APP'.padEnd(24)}{'SYSTEMD'.padEnd(14)}{'CONTAINERS'.padEnd(14)}HEALTH</Text>
      </Box>

      <AppList
        items={items}
        onSelect={(item) => {
          dispatch({ type: 'SELECT_APP', app: item.name });
          dispatch({ type: 'NAVIGATE', view: 'app-detail' });
        }}
        renderItem={(item, selected) => {
          const app = status.apps.find(a => a.name === item.name)!;
          return (
            <Box>
              <Text bold={selected} color={selected ? colors.primary : colors.text}>
                {redact(app.name).padEnd(22)}
              </Text>
              <Text>  </Text>
              <Box width={14}>
                <StatusBadge value={app.systemd} type="systemd" />
              </Box>
              <Box width={14}>
                <Text>{app.containers}</Text>
              </Box>
              <StatusBadge value={app.health} type="health" />
            </Box>
          );
        }}
      />
    </Box>
  );
}
