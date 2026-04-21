import React, { useMemo } from 'react';

import { Box, Text } from 'ink';
import { Timeline } from '@matthesketh/ink-timeline';

import type { RoutineEngine } from '@/core/routines/engine.js';
import { loadIncidents, type IncidentKind } from '@/core/routines/incidents.js';
import { formatRelative, truncate } from '@/tui/routines/format.js';

export interface TimelineTabProps {
  engine: RoutineEngine;
  sinceDays?: number;
}

const KIND_META: Record<IncidentKind, { typeLabel: string; typeColor: string }> = {
  'routine-failed': { typeLabel: 'FAIL', typeColor: 'red' },
  'routine-timeout': { typeLabel: 'TIMEOUT', typeColor: 'yellow' },
  'signal-error': { typeLabel: 'ERROR', typeColor: 'red' },
  'signal-warn': { typeLabel: 'WARN', typeColor: 'yellow' },
};

export function TimelineTab({ engine, sinceDays = 7 }: TimelineTabProps): React.JSX.Element {
  const incidents = useMemo(() => loadIncidents(engine.db, { sinceDays, limit: 50 }), [engine.db, sinceDays]);

  const events = incidents.map(i => ({
    time: new Date(i.at),
    type: KIND_META[i.kind].typeLabel,
    typeColor: KIND_META[i.kind].typeColor,
    title: i.subject,
    description: truncate(i.detail || '—', 100),
  }));

  const failCount = incidents.filter(i => i.kind === 'routine-failed' || i.kind === 'routine-timeout').length;
  const warnCount = incidents.filter(i => i.kind === 'signal-warn').length;
  const errCount = incidents.filter(i => i.kind === 'signal-error').length;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold>Incident timeline</Text>
        <Text color="gray">last {sinceDays}d</Text>
        <Text color="red">{failCount} routine failures</Text>
        <Text color="red">{errCount} signal errors</Text>
        <Text color="yellow">{warnCount} signal warns</Text>
      </Box>

      {events.length === 0 ? (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green">  nothing to report — all clear</Text>
        </Box>
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Timeline events={events} maxVisible={20} showRelativeTime />
        </Box>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Raw stream</Text>
        {incidents.slice(0, 20).map((i, idx) => (
          <Box key={idx}>
            <Box width={18}><Text color="gray">{formatRelative(i.at)}</Text></Box>
            <Box width={12}><Text color={KIND_META[i.kind].typeColor}>{KIND_META[i.kind].typeLabel}</Text></Box>
            <Box width={30}><Text>{truncate(i.subject, 28)}</Text></Box>
            <Text color="gray">{truncate(i.detail, 60)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
