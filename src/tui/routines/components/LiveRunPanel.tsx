import React, { useEffect, useRef, useState } from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

import type { RoutineEngine } from '../../../core/routines/engine.js';
import type { RunEvent, RunStatus } from '../../../core/routines/schema.js';
import { formatDuration, formatUsd, truncate } from '../format.js';

export interface LiveRunPanelProps {
  engine: RoutineEngine;
  routineId: string;
  target?: { repo: string | null; repoPath: string | null };
  onClose(): void;
}

interface FeedLine {
  kind: 'stdout' | 'stderr' | 'tool-call' | 'info';
  text: string;
}

export function LiveRunPanel({ engine, routineId, target, onClose }: LiveRunPanelProps): React.JSX.Element {
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [status, setStatus] = useState<'starting' | 'running' | RunStatus>('starting');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [cost, setCost] = useState<Extract<RunEvent, { kind: 'cost' }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    const append = (line: FeedLine): void => {
      setFeed(prev => (prev.length < 200 ? [...prev, line] : [...prev.slice(-199), line]));
    };

    void (async (): Promise<void> => {
      try {
        for await (const ev of engine.runOnce(routineId, target ?? { repo: null, repoPath: null }, 'manual', ac.signal)) {
          switch (ev.kind) {
            case 'start':
              setStartedAt(Date.now());
              setStatus('running');
              append({ kind: 'info', text: `▶ start ${routineId}${ev.target ? ` · ${ev.target}` : ''}` });
              break;
            case 'stdout':
              for (const l of ev.chunk.split('\n')) if (l.trim()) append({ kind: 'stdout', text: l });
              break;
            case 'stderr':
              for (const l of ev.chunk.split('\n')) if (l.trim()) append({ kind: 'stderr', text: l });
              break;
            case 'tool-call':
              append({ kind: 'tool-call', text: `${ev.name}${ev.argsPreview ? ` ${ev.argsPreview}` : ''}` });
              break;
            case 'cost':
              setCost(ev);
              break;
            case 'end':
              setEndedAt(Date.now());
              setStatus(ev.status);
              if (ev.error) setError(ev.error);
              append({ kind: 'info', text: `◼ ${ev.status} exit=${ev.exitCode} (${formatDuration(ev.durationMs)})` });
              break;
          }
        }
      } catch (err) {
        setStatus('failed');
        setEndedAt(Date.now());
        setError((err as Error).message);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [engine, routineId, target?.repo, target?.repoPath]);

  useRegisterHandler((input, key) => {
    if (status === 'running' || status === 'starting') {
      if (input === 'a') {
        abortRef.current?.abort();
        return true;
      }
      return false;
    }
    if (key.escape || key.return || input === 'q') {
      onClose();
      return true;
    }
    return false;
  });

  const running = status === 'starting' || status === 'running';
  const statusColor = ((): string => {
    switch (status) {
      case 'ok': return 'green';
      case 'failed': return 'red';
      case 'timeout': return 'yellow';
      case 'aborted': return 'gray';
      case 'running': return 'cyan';
      case 'starting': return 'cyan';
      default: return 'gray';
    }
  })();

  const elapsed = startedAt
    ? (endedAt ?? Date.now()) - startedAt
    : 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={statusColor} paddingX={1}>
      <Box gap={2}>
        <Text bold color={statusColor}>
          {running ? <><Spinner type="dots" /> {status}</> : <>◼ {status}</>}
        </Text>
        <Text color="gray">{routineId}</Text>
        {target?.repo && <Text color="yellow">· {target.repo}</Text>}
        <Text color="gray">· {formatDuration(elapsed)}</Text>
        {cost && <Text color="magenta">· {formatUsd(cost.usd)}</Text>}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {feed.slice(-18).map((line, i) => {
          const color = line.kind === 'stderr' ? 'red'
            : line.kind === 'tool-call' ? 'magenta'
              : line.kind === 'info' ? 'cyan'
                : undefined;
          const prefix = line.kind === 'tool-call' ? '↳ '
            : line.kind === 'stderr' ? '✖ '
              : line.kind === 'info' ? '' : '  ';
          return (
            <Text key={i} color={color}>{prefix}{truncate(line.text, 160)}</Text>
          );
        })}
        {feed.length === 0 && running && <Text color="gray">  (no output yet)</Text>}
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">✖ {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          {running
            ? 'a abort · q cancel and close'
            : 'Enter / Esc / q close'}
        </Text>
      </Box>
    </Box>
  );
}
