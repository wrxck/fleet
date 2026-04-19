import React, { useMemo } from 'react';

import { Box, Text } from 'ink';

import type { RoutineEngine, RecentRun } from '../../../core/routines/engine.js';
import type { Routine } from '../../../core/routines/schema.js';
import { formatDuration, formatRelative, formatUsd, truncate } from '../format.js';

interface RoutineRow {
  routine: Routine;
  recent: RecentRun[];
  lastRun: RecentRun | null;
  streakSuccess: number;
  totalUsd: number;
}

export interface RoutinesTabProps {
  engine: RoutineEngine;
  routines: Routine[];
  selectedIndex: number;
  detailOpen: boolean;
}

function summarise(engine: RoutineEngine, routine: Routine): RoutineRow {
  const recent = engine.recentRuns(routine.id, 10);
  const lastRun = recent[0] ?? null;
  let streakSuccess = 0;
  for (const r of recent) {
    if (r.status === 'ok') streakSuccess++;
    else break;
  }
  const costAgg = engine.costSinceDays(routine.id, 30);
  return { routine, recent, lastRun, streakSuccess, totalUsd: costAgg.usd };
}

function statusColor(status: string | null): string {
  switch (status) {
    case 'ok': return 'green';
    case 'failed': return 'red';
    case 'timeout': return 'yellow';
    case 'aborted': return 'gray';
    case 'running': return 'cyan';
    default: return 'gray';
  }
}

function ScheduleBadge({ routine }: { routine: Routine }): React.JSX.Element {
  if (routine.schedule.kind === 'manual') {
    return <Text color="gray">manual</Text>;
  }
  return <Text color="cyan">{routine.schedule.onCalendar}</Text>;
}

function RoutineListRow({
  row,
  selected,
}: {
  row: RoutineRow;
  selected: boolean;
}): React.JSX.Element {
  const { routine, lastRun, streakSuccess } = row;
  const targetCount = routine.targets.length || (routine.perTarget ? 0 : 1);
  const targetLabel = routine.perTarget
    ? routine.targets.length > 0 ? `${routine.targets.length}×` : 'all×'
    : 'singleton';

  return (
    <Box>
      <Box width={2}>
        <Text color={selected ? 'cyan' : undefined}>{selected ? '▶' : ' '}</Text>
      </Box>
      <Box width={2}>
        {routine.enabled ? <Text color="green">●</Text> : <Text color="gray">○</Text>}
      </Box>
      <Box width={22}>
        <Text bold={selected}>{truncate(routine.id, 20)}</Text>
      </Box>
      <Box width={14}>
        <Text>
          <Text color={statusColor(lastRun?.status ?? null)}>{lastRun?.status ?? '—'}</Text>
        </Text>
      </Box>
      <Box width={10}>
        <Text>{streakSuccess > 0 ? <Text color="green">×{streakSuccess}</Text> : <Text color="gray">—</Text>}</Text>
      </Box>
      <Box width={16}>
        <Text color="gray">{formatRelative(lastRun?.startedAt ?? null)}</Text>
      </Box>
      <Box width={10}>
        <Text color="gray">{formatDuration(lastRun?.durationMs ?? null)}</Text>
      </Box>
      <Box width={10}>
        <Text color="gray">{formatUsd(row.totalUsd)}</Text>
      </Box>
      <Box width={12}>
        <Text color="gray">{targetLabel}</Text>
      </Box>
      <ScheduleBadge routine={routine} />
    </Box>
  );
}

function RoutineListHeader(): React.JSX.Element {
  return (
    <Box>
      <Box width={2}><Text> </Text></Box>
      <Box width={2}><Text bold>ON</Text></Box>
      <Box width={22}><Text bold>ID</Text></Box>
      <Box width={14}><Text bold>LAST</Text></Box>
      <Box width={10}><Text bold>STREAK</Text></Box>
      <Box width={16}><Text bold>WHEN</Text></Box>
      <Box width={10}><Text bold>DUR</Text></Box>
      <Box width={10}><Text bold>30d $</Text></Box>
      <Box width={12}><Text bold>TARGETS</Text></Box>
      <Text bold>SCHEDULE</Text>
    </Box>
  );
}

function RecentRunsPanel({ runs }: { runs: RecentRun[] }): React.JSX.Element {
  if (runs.length === 0) return <Text color="gray">  no runs yet</Text>;
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={22}><Text bold>WHEN</Text></Box>
        <Box width={12}><Text bold>STATUS</Text></Box>
        <Box width={10}><Text bold>DUR</Text></Box>
        <Box width={10}><Text bold>EXIT</Text></Box>
        <Box width={10}><Text bold>USD</Text></Box>
        <Box width={12}><Text bold>TOKENS</Text></Box>
        <Text bold>ERROR</Text>
      </Box>
      {runs.map(r => (
        <Box key={r.runId}>
          <Box width={22}><Text color="gray">{formatRelative(r.startedAt)}</Text></Box>
          <Box width={12}><Text color={statusColor(r.status)}>{r.status}</Text></Box>
          <Box width={10}><Text>{formatDuration(r.durationMs)}</Text></Box>
          <Box width={10}><Text>{r.exitCode ?? '—'}</Text></Box>
          <Box width={10}><Text>{formatUsd(r.usd)}</Text></Box>
          <Box width={12}><Text>{r.inputTokens != null ? `${(r.inputTokens + (r.outputTokens ?? 0)).toLocaleString()}` : '—'}</Text></Box>
          <Text color="red">{truncate(r.error ?? '', 40)}</Text>
        </Box>
      ))}
    </Box>
  );
}

function RoutineDetail({ row }: { row: RoutineRow }): React.JSX.Element {
  const { routine, recent } = row;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text bold color="cyan">{routine.id}</Text>
        <Text>{routine.name}</Text>
        {routine.description && <Text color="gray">{routine.description}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text bold>Schedule</Text>
        <Box>
          <Text color="gray">  kind:     </Text>
          <Text>{routine.schedule.kind}</Text>
        </Box>
        {routine.schedule.kind === 'calendar' && (
          <>
            <Box>
              <Text color="gray">  when:     </Text>
              <Text>{routine.schedule.onCalendar}</Text>
            </Box>
            <Box>
              <Text color="gray">  jitter:   </Text>
              <Text>{routine.schedule.randomizedDelaySec}s</Text>
            </Box>
          </>
        )}
      </Box>

      <Box flexDirection="column">
        <Text bold>Task</Text>
        <Box>
          <Text color="gray">  runner:   </Text>
          <Text>{routine.task.kind}</Text>
        </Box>
        {routine.task.kind === 'claude-cli' && (
          <>
            <Box><Text color="gray">  tokens:   </Text><Text>{routine.task.tokenCap.toLocaleString()}</Text></Box>
            <Box><Text color="gray">  max USD:  </Text><Text>{formatUsd(routine.task.maxUsd)}</Text></Box>
            <Box><Text color="gray">  timeout:  </Text><Text>{formatDuration(routine.task.wallClockMs)}</Text></Box>
            <Box><Text color="gray">  prompt:   </Text><Text>{truncate(routine.task.prompt, 80)}</Text></Box>
          </>
        )}
        {routine.task.kind === 'shell' && (
          <>
            <Box><Text color="gray">  argv:     </Text><Text>{truncate(routine.task.argv.join(' '), 80)}</Text></Box>
            <Box><Text color="gray">  timeout:  </Text><Text>{formatDuration(routine.task.wallClockMs)}</Text></Box>
          </>
        )}
        {routine.task.kind === 'mcp-call' && (
          <>
            <Box><Text color="gray">  tool:     </Text><Text>{routine.task.tool}</Text></Box>
            <Box><Text color="gray">  timeout:  </Text><Text>{formatDuration(routine.task.wallClockMs)}</Text></Box>
          </>
        )}
      </Box>

      <Box flexDirection="column">
        <Text bold>Recent runs</Text>
        <RecentRunsPanel runs={recent} />
      </Box>
    </Box>
  );
}

export function RoutinesTab({
  engine,
  routines,
  selectedIndex,
  detailOpen,
}: RoutinesTabProps): React.JSX.Element {
  const rows = useMemo(() => routines.map(r => summarise(engine, r)), [engine, routines]);
  const selected = rows[selectedIndex];

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Routines ({rows.length})</Text>
      <Box flexDirection="column">
        <RoutineListHeader />
        {rows.length === 0 && <Text color="gray">  no routines yet</Text>}
        {rows.map((row, i) => (
          <RoutineListRow key={row.routine.id} row={row} selected={i === selectedIndex} />
        ))}
      </Box>
      {detailOpen && selected && <RoutineDetail row={selected} />}
      {!detailOpen && selected && (
        <Text color="gray">press Enter for detail · r run now · e toggle enabled</Text>
      )}
    </Box>
  );
}
