import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { runFleetCommand } from '../exec-bridge.js';
import { colors } from '../theme.js';
import { load, findApp } from '../../core/registry.js';

interface ActionItem {
  key: string;
  label: string;
  command: string[];
  destructive?: boolean;
}

const ACTIONS: ActionItem[] = [
  { key: '1', label: 'Start', command: ['start'] },
  { key: '2', label: 'Stop', command: ['stop'], destructive: true },
  { key: '3', label: 'Restart', command: ['restart'] },
  { key: '4', label: 'Deploy', command: ['deploy'], destructive: true },
  { key: '5', label: 'Logs', command: ['logs'] },
];

export function AppDetail(): React.JSX.Element {
  const { selectedApp, redacted } = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const [actionIndex, setActionIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null);

  const reg = load();
  const app = selectedApp ? findApp(reg, selectedApp) : undefined;

  useInput((input, key) => {
    if (running) return;

    if (input === 'j' || key.downArrow) {
      setActionIndex(prev => Math.min(prev + 1, ACTIONS.length - 1));
    } else if (input === 'k' || key.upArrow) {
      setActionIndex(prev => Math.max(prev - 1, 0));
    } else if (key.return) {
      const action = ACTIONS[actionIndex];
      if (action.command[0] === 'logs') {
        dispatch({ type: 'NAVIGATE', view: 'logs' });
        return;
      }
      if (action.destructive) {
        dispatch({
          type: 'CONFIRM',
          action: {
            label: `${action.label} ${selectedApp}?`,
            description: `This will ${action.label.toLowerCase()} the ${selectedApp} service.`,
            onConfirm: () => executeAction(action),
          },
        });
      } else {
        executeAction(action);
      }
    }
  });

  function executeAction(action: ActionItem) {
    if (!selectedApp) return;
    setRunning(true);
    setResult(null);
    runFleetCommand([...action.command, selectedApp]).then(res => {
      setResult(res);
      setRunning(false);
    });
  }

  if (!app) {
    return (
      <Box padding={1}>
        <Text color={colors.error}>App not found: {selectedApp}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={colors.primary}>{redact(app.displayName || app.name)}</Text>
      <Box marginY={1} flexDirection="column">
        <Text><Text color={colors.muted}>Type:      </Text>{app.type}</Text>
        <Text><Text color={colors.muted}>Service:   </Text>{redacted ? '***' : app.serviceName}</Text>
        <Text><Text color={colors.muted}>Compose:   </Text>{redacted ? '***' : app.composePath}</Text>
        {app.domains.length > 0 && (
          <Text><Text color={colors.muted}>Domains:   </Text>{redacted ? '***' : app.domains.join(', ')}</Text>
        )}
        {app.port && (
          <Text><Text color={colors.muted}>Port:      </Text>{app.port}</Text>
        )}
        <Text><Text color={colors.muted}>Containers:</Text> {redacted ? '***' : app.containers.join(', ')}</Text>
        {app.gitRepo && (
          <Text><Text color={colors.muted}>Git:       </Text>{redacted ? '***' : app.gitRepo}</Text>
        )}
      </Box>

      <Text bold>Actions</Text>
      <Box flexDirection="column" marginTop={1}>
        {ACTIONS.map((action, i) => {
          const selected = i === actionIndex;
          return (
            <Text key={action.key}>
              <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
              <Text bold={selected} color={selected ? colors.primary : colors.text}>
                [{action.key}] {action.label}
              </Text>
              {action.destructive && <Text color={colors.warning}> !</Text>}
            </Text>
          );
        })}
      </Box>

      {running && (
        <Box marginTop={1}>
          <Text><Spinner type="dots" /> Running...</Text>
        </Box>
      )}

      {result && (
        <Box marginTop={1} flexDirection="column">
          <Text color={result.ok ? colors.success : colors.error}>
            {result.ok ? 'Done' : 'Failed'}
          </Text>
          {result.output && (
            <Text color={colors.muted}>{result.output.trim().slice(0, 500)}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
