import React, { useMemo, useState } from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { LogViewer } from '@matthesketh/ink-log-viewer';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

import type { AppEntry } from '@/core/registry.js';
import { truncate } from '@/tui/routines/format.js';
import { useLogsStream, type LogsStreamOptions } from '@/tui/routines/hooks/use-logs-stream.js';

export interface LogsTabProps {
  apps: AppEntry[];
}

type Source =
  | { kind: 'none' }
  | { kind: 'service'; name: string }
  | { kind: 'container'; containerId: string };

export function LogsTab({ apps }: LogsTabProps): React.JSX.Element {
  const services = useMemo(() => {
    const list = apps
      .filter(a => a.serviceName)
      .map(a => ({ name: a.serviceName, displayName: a.displayName || a.name }));
    return [{ name: 'docker-databases', displayName: 'docker-databases (shared)' }, ...list];
  }, [apps]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [source, setSource] = useState<Source>({ kind: 'none' });
  const [filter, setFilter] = useState<'' | 'warn' | 'error'>('');

  const opts: LogsStreamOptions | null = source.kind === 'service'
    ? { command: 'journalctl', args: ['-u', source.name, '-f', '-n', '200', '--no-pager'] }
    : source.kind === 'container'
      ? { command: 'docker', args: ['logs', '-f', '--tail', '200', source.containerId] }
      : null;

  const stream = useLogsStream(opts);

  useRegisterHandler((input, key) => {
    if (input === 'j' || key.downArrow) {
      setSelectedIdx(i => Math.min(i + 1, services.length - 1));
      return true;
    }
    if (input === 'k' || key.upArrow) {
      setSelectedIdx(i => Math.max(i - 1, 0));
      return true;
    }
    if (key.return && services[selectedIdx]) {
      setSource({ kind: 'service', name: services[selectedIdx].name });
      return true;
    }
    if (input === 'w') { setFilter(f => f === 'warn' ? '' : 'warn'); return true; }
    if (input === 'x') { setFilter(f => f === 'error' ? '' : 'error'); return true; }
    if (input === 'c') { setFilter(''); return true; }
    if (key.escape && source.kind !== 'none') { setSource({ kind: 'none' }); return true; }
    return false;
  });

  const filterPattern = filter ? filter : undefined;

  return (
    <Box flexDirection="row" gap={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={34}>
        <Text bold>Services</Text>
        {services.length === 0 && <Text color="gray">  no services</Text>}
        {services.map((s, i) => (
          <Box key={s.name}>
            <Box width={2}>
              <Text color={i === selectedIdx ? 'cyan' : undefined}>{i === selectedIdx ? '▶' : ' '}</Text>
            </Box>
            <Text
              color={source.kind === 'service' && source.name === s.name ? 'green' : undefined}
              bold={i === selectedIdx}
            >
              {truncate(s.displayName, 28)}
            </Text>
          </Box>
        ))}
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">j/k pick · Enter tail · w warn · x error · c clear · Esc stop</Text>
        </Box>
      </Box>

      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={stream.running ? 'cyan' : 'gray'} paddingX={1}>
        <Box gap={2}>
          <Text bold color="cyan">
            {source.kind === 'none' ? 'pick a service' : `tail · ${source.kind === 'service' ? source.name : source.containerId}`}
          </Text>
          {stream.running && <Text color="cyan"><Spinner type="dots" /> live</Text>}
          {filter && <Text color="yellow">filter: {filter}</Text>}
          <Text color="gray">{stream.lines.length} lines</Text>
        </Box>
        {stream.error && <Text color="red">✖ {stream.error}</Text>}
        {stream.lines.length === 0 && !stream.error && source.kind !== 'none' && (
          <Text color="gray">  (waiting for output…)</Text>
        )}
        {stream.lines.length > 0 && (
          <LogViewer lines={stream.lines} height={20} autoScroll filter={filterPattern} showLevel />
        )}
      </Box>
    </Box>
  );
}
