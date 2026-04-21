import React, { useMemo } from 'react';

import { Box, Text } from 'ink';
import { LineChart } from '@matthesketh/ink-chart';

import type { RoutineEngine } from '@/core/routines/engine.js';
import { costByRoutine, costRollup, dailyCostSeries } from '@/core/routines/cost-queries.js';
import { formatUsd, truncate } from '@/tui/routines/format.js';

export interface CostTabProps {
  engine: RoutineEngine;
  dailyBudgetUsd?: number;
}

function usdColor(usd: number, soft = 1, hard = 5): string {
  if (usd >= hard) return 'red';
  if (usd >= soft) return 'yellow';
  return 'green';
}

export function CostTab({ engine, dailyBudgetUsd = 10 }: CostTabProps): React.JSX.Element {
  const { rollup, byRoutine, daily } = useMemo(() => ({
    rollup: costRollup(engine.db),
    byRoutine: costByRoutine(engine.db, 30, 10),
    daily: dailyCostSeries(engine.db, 14),
  }), [engine.db]);

  const projectedDaily = rollup.usdToday;
  const dailyBudgetExceeded = projectedDaily > dailyBudgetUsd;
  const series = daily.map(d => d.usd);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold>Cost / usage</Text>
        <Text color={usdColor(rollup.usdToday, dailyBudgetUsd / 2, dailyBudgetUsd)}>
          today {formatUsd(rollup.usdToday)}
        </Text>
        <Text color="gray">week {formatUsd(rollup.usdWeek)}</Text>
        <Text color="gray">month {formatUsd(rollup.usdMonth)}</Text>
        {dailyBudgetExceeded && (
          <Text color="red" bold>over daily budget ({formatUsd(dailyBudgetUsd)})</Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Daily spend (last 14 days)</Text>
        {series.every(v => v === 0) ? (
          <Text color="gray">  no claude-cli runs with cost yet</Text>
        ) : (
          <LineChart data={series} width={60} height={8} color="cyan" showAxis label="USD / day" />
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Top routines by spend (30d)</Text>
        {byRoutine.length === 0 && <Text color="gray">  no runs yet</Text>}
        <Box>
          <Box width={24}><Text bold>ROUTINE</Text></Box>
          <Box width={10}><Text bold>RUNS</Text></Box>
          <Box width={12}><Text bold>USD</Text></Box>
          <Box width={14}><Text bold>IN TOKENS</Text></Box>
          <Box width={14}><Text bold>OUT TOKENS</Text></Box>
          <Text bold>AVG / RUN</Text>
        </Box>
        {byRoutine.map(row => (
          <Box key={row.routineId}>
            <Box width={24}><Text>{truncate(row.routineId, 22)}</Text></Box>
            <Box width={10}><Text>{row.runs}</Text></Box>
            <Box width={12}><Text color={usdColor(row.usd)}>{formatUsd(row.usd)}</Text></Box>
            <Box width={14}><Text color="gray">{row.inputTokens.toLocaleString()}</Text></Box>
            <Box width={14}><Text color="gray">{row.outputTokens.toLocaleString()}</Text></Box>
            <Text color="gray">{row.runs > 0 ? formatUsd(row.usd / row.runs) : '—'}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Last 14 days (buckets)</Text>
        {daily.map(bucket => (
          <Box key={bucket.date}>
            <Box width={12}><Text color="gray">{bucket.date}</Text></Box>
            <Box width={12}><Text color={usdColor(bucket.usd)}>{formatUsd(bucket.usd)}</Text></Box>
            <Text color="gray">{bucket.runs} runs</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
