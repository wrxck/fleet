import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import { useAvailableHeight } from '@matthesketh/ink-viewport';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

import { colors } from '../theme.js';
import { useRedact } from '../state.js';
import { load } from '../../core/registry.js';
import {
  startMultiTail,
  resolveSources,
  type LogLine,
  type LogSource,
  type MultiTailHandle,
} from '../../core/logs-multi.js';
import type { LogPolicy } from '../../core/logs-policy.js';

const MAX_LINES = 500;
const LEVEL_RANKS = ['debug', 'info', 'warn', 'error', 'all'] as const;
type LevelChoice = (typeof LEVEL_RANKS)[number];
const LEVEL_RANK_NUMBER: Record<'debug' | 'info' | 'warn' | 'error', number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

const SOURCE_PALETTE = [colors.primary, colors.success, colors.warning, colors.muted, 'cyan', 'magenta'] as const;
function colourForSource(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return SOURCE_PALETTE[Math.abs(h) % SOURCE_PALETTE.length];
}

interface BufferedLine extends LogLine {
  /** Monotonic id for stable React keys without depending on text. */
  id: number;
}

export function MultiLogsView(): React.JSX.Element {
  const redact = useRedact();
  const availableHeight = useAvailableHeight();

  const allSources = useMemo<LogSource[]>(() => {
    try {
      return resolveSources(load().apps);
    } catch {
      return [];
    }
  }, []);

  // Selection: by default, every container. User toggles with Space.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(allSources.map(s => `${s.app}/${s.container}`)),
  );
  const [pickerIndex, setPickerIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<LevelChoice>('all');
  const [lines, setLines] = useState<BufferedLine[]>([]);
  const [pickerFocused, setPickerFocused] = useState(true);

  const handleRef = useRef<MultiTailHandle | null>(null);
  const lineIdRef = useRef(0);
  // Buffer lines between renders so we batch React updates and don't flicker
  // when bursts of output land. flushed every 100ms.
  const pendingRef = useRef<BufferedLine[]>([]);

  // (Re)start tailers whenever the selection changes.
  useEffect(() => {
    if (handleRef.current) {
      void handleRef.current.stop();
      handleRef.current = null;
    }
    pendingRef.current = [];
    setLines([]);

    const sources = allSources.filter(s => selected.has(`${s.app}/${s.container}`));
    if (sources.length === 0) return;

    const handle = startMultiTail(sources, { tail: 30, follow: true }, line => {
      pendingRef.current.push({ ...line, id: ++lineIdRef.current });
    });
    handleRef.current = handle;

    return () => { void handle.stop(); };
  }, [allSources, selected]);

  // Flush buffered lines into state on a 100ms tick (batched to avoid flicker).
  useEffect(() => {
    const t = setInterval(() => {
      if (paused) return;
      if (pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setLines(prev => {
        const merged = prev.length + batch.length > MAX_LINES
          ? [...prev, ...batch].slice(-MAX_LINES)
          : [...prev, ...batch];
        return merged;
      });
    }, 100);
    return () => clearInterval(t);
  }, [paused]);

  const handler: InputHandler = (input, key) => {
    // Tab toggles focus between picker and viewport (so j/k goes to the right place).
    if (key.tab) { setPickerFocused(p => !p); return true; }

    if (pickerFocused) {
      if (input === 'j' || key.downArrow) {
        setPickerIndex(i => Math.min(i + 1, allSources.length - 1));
        return true;
      }
      if (input === 'k' || key.upArrow) {
        setPickerIndex(i => Math.max(i - 1, 0));
        return true;
      }
      if (input === ' ') {
        const src = allSources[pickerIndex];
        if (!src) return true;
        const k = `${src.app}/${src.container}`;
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(k)) next.delete(k); else next.add(k);
          return next;
        });
        return true;
      }
      if (input === 'a') {
        // Select / deselect all
        setSelected(prev =>
          prev.size === allSources.length
            ? new Set()
            : new Set(allSources.map(s => `${s.app}/${s.container}`)),
        );
        return true;
      }
    }

    if (input === 'p') { setPaused(p => !p); return true; }
    if (input === 'c') { setLines([]); pendingRef.current = []; return true; }
    if (input === 'L') {
      // Cycle level filter
      setLevel(l => LEVEL_RANKS[(LEVEL_RANKS.indexOf(l) + 1) % LEVEL_RANKS.length]);
      return true;
    }
    return false;
  };
  useRegisterHandler(handler);

  // Apply level filter at render time so the buffer keeps everything (cheap to
  // change filter back and forth without losing history).
  const filteredLines = useMemo(() => {
    if (level === 'all') return lines;
    const minRank = LEVEL_RANK_NUMBER[level as 'debug' | 'info' | 'warn' | 'error'];
    return lines.filter(l => {
      if (l.level === 'unknown') return false;
      return LEVEL_RANK_NUMBER[l.level as 'debug' | 'info' | 'warn' | 'error'] >= minRank;
    });
  }, [lines, level]);

  // Rough split of the viewport: 30% picker, 70% logs (min 5 rows each).
  const totalH = Math.max(10, availableHeight - 4);
  const pickerH = Math.max(5, Math.floor(totalH * 0.3));
  const logsH = Math.max(5, totalH - pickerH - 1);
  const visibleLogs = filteredLines.slice(-logsH);

  const maxLabelLen = useMemo(
    () => allSources.reduce((m, s) => Math.max(m, `${s.app}/${s.container}`.length), 0),
    [allSources],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold color={colors.primary}>Multi-source Logs</Text>
        <Text color={colors.muted}>
          {selected.size}/{allSources.length} sources · level:{level} · {paused ? 'PAUSED' : 'live'}
        </Text>
        {!paused && handleRef.current && handleRef.current.active() > 0 && (
          <Text color={colors.success}><Spinner type="dots" /> tailing</Text>
        )}
      </Box>

      <Box flexDirection="column" height={pickerH} marginBottom={1} borderStyle={pickerFocused ? 'round' : 'single'} borderColor={pickerFocused ? colors.primary : colors.muted}>
        <Box paddingX={1}>
          <Text bold color={colors.muted}>
            Sources [Tab to switch focus, Space toggle, a all/none]
          </Text>
        </Box>
        <Box flexDirection="column" paddingX={1}>
          {allSources.slice(0, pickerH - 2).map((src, i) => {
            const k = `${src.app}/${src.container}`;
            const checked = selected.has(k);
            const cursor = pickerFocused && i === pickerIndex ? '>' : ' ';
            return (
              <Text key={k} color={checked ? colors.success : colors.muted}>
                {cursor} {checked ? '☑' : '☐'} {redact(src.app)}/{src.container}
              </Text>
            );
          })}
          {allSources.length > pickerH - 2 && (
            <Text color={colors.muted}>… {allSources.length - (pickerH - 2)} more</Text>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" height={logsH} borderStyle={!pickerFocused ? 'round' : 'single'} borderColor={!pickerFocused ? colors.primary : colors.muted}>
        <Box paddingX={1}>
          <Text bold color={colors.muted}>
            Logs [p pause · c clear · L level cycle · last {visibleLogs.length}/{filteredLines.length}]
          </Text>
        </Box>
        <Box flexDirection="column" paddingX={1}>
          {visibleLogs.map(line => {
            const label = `${line.app}/${line.container}`.padEnd(maxLabelLen);
            const colour = colourForSource(`${line.app}/${line.container}`);
            const ts = line.ts.toISOString().slice(11, 19);  // HH:MM:SS
            return (
              <Text key={line.id} wrap="truncate">
                <Text color={colors.muted}>{ts} </Text>
                <Text color={colour}>{label}</Text>
                <Text> {line.text}</Text>
              </Text>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
