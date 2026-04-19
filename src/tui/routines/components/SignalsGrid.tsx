import React, { useMemo } from 'react';

import { Box, Text } from 'ink';

import type { Signal, SignalKind } from '../../../core/routines/schema.js';
import { signalStateColor, signalStateGlyph, truncate } from '../format.js';

export interface SignalsGridRow {
  repo: string;
  signals: Signal[];
}

export interface SignalsGridProps {
  rows: SignalsGridRow[];
  selectedIndex: number;
  kinds: SignalKind[];
  nameWidth?: number;
}

const KIND_LABEL: Record<SignalKind, string> = {
  'git-clean': 'GIT',
  'git-ahead': 'AHEAD',
  'git-behind': 'BEHIND',
  'open-prs': 'PRS',
  'pr-age-max': 'PR-AGE',
  'deps-outdated': 'DEPS',
  'deps-vulns': 'VULNS',
  'build-ok': 'BUILD',
  'tests-ok': 'TESTS',
  'env-schema-ok': 'ENV',
  'container-up': 'CTRS',
  'ci-status': 'CI',
  'cache-age': 'CACHE',
};

function Cell({ signal }: { signal: Signal | undefined }): React.JSX.Element {
  if (!signal) return <Text color="gray">  ·  </Text>;
  const color = signalStateColor[signal.state];
  const glyph = signalStateGlyph[signal.state];
  return <Text color={color}>  {glyph}  </Text>;
}

export function SignalsGrid({ rows, selectedIndex, kinds, nameWidth = 22 }: SignalsGridProps): React.JSX.Element {
  const header = useMemo(() => kinds.map(k => KIND_LABEL[k].padEnd(5).slice(0, 5)).join(''), [kinds]);

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={nameWidth + 2}>
          <Text bold>REPO</Text>
        </Box>
        <Text bold>{header}</Text>
      </Box>
      {rows.length === 0 && (
        <Text color="gray">  no repos registered — run `fleet add`</Text>
      )}
      {rows.map((row, idx) => {
        const byKind = new Map(row.signals.map(s => [s.kind, s]));
        const selected = idx === selectedIndex;
        return (
          <Box key={row.repo}>
            <Box width={nameWidth + 2}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {selected ? '▶ ' : '  '}{truncate(row.repo, nameWidth)}
              </Text>
            </Box>
            {kinds.map(kind => <Cell key={kind} signal={byKind.get(kind)} />)}
          </Box>
        );
      })}
    </Box>
  );
}
