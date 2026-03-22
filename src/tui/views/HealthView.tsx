import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useHealth } from '../hooks/use-health.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useRedact } from '../state.js';
import { colors } from '../theme.js';

export function HealthView(): React.JSX.Element {
  const { results, loading, error } = useHealth();
  const redact = useRedact();

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

  const healthy = results.filter(r => r.overall === 'healthy').length;
  const degraded = results.filter(r => r.overall === 'degraded').length;
  const down = results.filter(r => r.overall === 'down').length;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold>Health Monitor</Text>
        <Text color={colors.success}>{healthy} healthy</Text>
        {degraded > 0 && <Text color={colors.warning}>{degraded} degraded</Text>}
        {down > 0 && <Text color={colors.error}>{down} down</Text>}
        {loading && <Text color={colors.muted}><Spinner type="dots" /></Text>}
      </Box>

      <Text bold>
        {'  APP'.padEnd(26)}{'SYSTEMD'.padEnd(12)}{'CONTAINERS'.padEnd(20)}{'HTTP'.padEnd(10)}OVERALL
      </Text>

      {results.map(result => {
        const runningCount = result.containers.filter(c => c.running).length;
        const containerStr = `${runningCount}/${result.containers.length}`;
        const httpStr = result.http
          ? result.http.ok ? `${result.http.status}` : `err`
          : 'n/a';

        return (
          <Box key={result.app}>
            <Text>{'  '}{redact(result.app).padEnd(24)}</Text>
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
      })}
    </Box>
  );
}
