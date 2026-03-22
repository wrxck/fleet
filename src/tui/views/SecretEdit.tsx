import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState, useAppDispatch } from '../state.js';
import { useSecrets } from '../hooks/use-secrets.js';
import { getSecret as getCoreSecret } from '../../core/secrets-ops.js';
import { colors } from '../theme.js';

export function SecretEdit(): React.JSX.Element {
  const { selectedApp, selectedSecret } = useAppState();
  const dispatch = useAppDispatch();
  const secrets = useSecrets();

  const isNew = selectedSecret === null;
  const [keyName, setKeyName] = useState(selectedSecret ?? '');
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<'key' | 'value'>(isNew ? 'key' : 'value');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew && selectedApp && selectedSecret) {
      try {
        const existing = getCoreSecret(selectedApp, selectedSecret);
        if (existing) setValue(existing);
      } catch {
        // ignore
      }
    }
  }, []);

  const save = () => {
    if (!selectedApp || !keyName) return;
    const result = secrets.saveSecret(selectedApp, keyName, value);
    if (result.ok) {
      setStatus('Saved and re-sealed');
      setTimeout(() => {
        dispatch({ type: 'GO_BACK' });
      }, 500);
    } else {
      setStatus(`Error: ${result.error}`);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      dispatch({ type: 'GO_BACK' });
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={colors.primary}>
        {isNew ? 'Add Secret' : 'Edit Secret'} - {selectedApp}
      </Text>

      <Box marginTop={1} flexDirection="column" gap={1}>
        <Box>
          <Text color={colors.muted}>Key:   </Text>
          {isNew && phase === 'key' ? (
            <TextInput
              value={keyName}
              onChange={setKeyName}
              onSubmit={() => {
                if (keyName) setPhase('value');
              }}
            />
          ) : (
            <Text bold>{keyName}</Text>
          )}
        </Box>

        <Box>
          <Text color={colors.muted}>Value: </Text>
          {phase === 'value' ? (
            <TextInput
              value={value}
              onChange={setValue}
              onSubmit={save}
            />
          ) : (
            <Text color={colors.muted}>(press Enter on key first)</Text>
          )}
        </Box>
      </Box>

      {status && (
        <Box marginTop={1}>
          <Text color={status.startsWith('Error') ? colors.error : colors.success}>
            {status}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={colors.muted}>Enter to save | Esc to cancel</Text>
      </Box>
    </Box>
  );
}
