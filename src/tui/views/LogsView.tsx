import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { runFleetCommand, streamFleetCommand, type StreamHandle } from '../exec-bridge.js';
import { colors } from '../theme.js';

const MAX_LINES = 100;

export function LogsView(): React.JSX.Element {
  const { selectedApp } = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const [lines, setLines] = useState<string[]>([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const streamRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    if (!selectedApp) return;
    setLoading(true);
    runFleetCommand(['logs', selectedApp]).then(result => {
      if (result.ok) {
        setLines(result.output.split('\n').slice(-MAX_LINES));
      } else {
        setLines([`Error: ${result.output}`]);
      }
      setLoading(false);
    });

    return () => {
      if (streamRef.current) {
        streamRef.current.kill();
        streamRef.current = null;
      }
    };
  }, [selectedApp]);

  useInput((input, key) => {
    if (input === 'f') {
      if (following) {
        // Stop following
        if (streamRef.current) {
          streamRef.current.kill();
          streamRef.current = null;
        }
        setFollowing(false);
      } else if (selectedApp) {
        // Start following
        setFollowing(true);
        const handle = streamFleetCommand(['logs', selectedApp, '-f']);
        streamRef.current = handle;
        handle.onData((line) => {
          setLines(prev => [...prev.slice(-MAX_LINES + 1), line]);
        });
      }
    } else if (key.escape) {
      if (streamRef.current) {
        streamRef.current.kill();
        streamRef.current = null;
      }
      dispatch({ type: 'GO_BACK' });
    }
  });

  if (loading) {
    return (
      <Box padding={1}>
        <Text><Spinner type="dots" /> Loading logs for {selectedApp}...</Text>
      </Box>
    );
  }

  // Show last N lines that fit in terminal
  const visibleLines = lines.slice(-30);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} gap={2}>
        <Text bold color={colors.primary}>Logs: {redact(selectedApp ?? '')}</Text>
        {following && (
          <Text color={colors.success}><Spinner type="dots" /> following</Text>
        )}
      </Box>

      <Box flexDirection="column">
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">{line}</Text>
        ))}
      </Box>
    </Box>
  );
}
