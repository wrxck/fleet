import React from 'react';

import { Box, Text } from 'ink';

import type { Signal } from '../../../core/routines/schema.js';
import { signalStateColor, truncate } from '../format.js';

export interface AlertsPanelProps {
  signals: Map<string, Signal[]>;
  maxRows?: number;
}

export function AlertsPanel({ signals, maxRows = 8 }: AlertsPanelProps): React.JSX.Element {
  const alerts: { repo: string; signal: Signal }[] = [];
  for (const [repo, list] of signals) {
    for (const sig of list) {
      if (sig.state === 'error' || sig.state === 'warn') {
        alerts.push({ repo, signal: sig });
      }
    }
  }
  alerts.sort((a, b) => {
    const order = (s: Signal): number => (s.state === 'error' ? 0 : 1);
    const diff = order(a.signal) - order(b.signal);
    if (diff !== 0) return diff;
    return a.repo.localeCompare(b.repo);
  });
  const rows = alerts.slice(0, maxRows);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Alerts ({alerts.length})</Text>
      {rows.length === 0 && <Text color="green">  all clear</Text>}
      {rows.map((a, i) => (
        <Box key={`${a.repo}-${a.signal.kind}-${i}`}>
          <Text color={signalStateColor[a.signal.state]}>● </Text>
          <Box width={20}><Text>{truncate(a.repo, 18)}</Text></Box>
          <Box width={14}><Text color="gray">{a.signal.kind}</Text></Box>
          <Text>{truncate(a.signal.detail || String(a.signal.value ?? ''), 50)}</Text>
        </Box>
      ))}
      {alerts.length > maxRows && (
        <Text color="gray">  +{alerts.length - maxRows} more…</Text>
      )}
    </Box>
  );
}
