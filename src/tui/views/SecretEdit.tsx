import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

import { useAppState, useAppDispatch } from '../state.js';
import { useSecrets } from '../hooks/use-secrets.js';
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // SECURITY: existing secret values are NEVER preloaded into editor state.
  // The TextInput's `mask="*"` only changes the rendered glyph — the
  // underlying React state would still hold plaintext, exposing it to
  // DevTools dumps, error boundary captures, and process memory dumps.
  // Editing requires re-typing the value, matching the CLI posture in
  // `src/commands/secrets.ts` which rejects argv values for the same reason.

  const save = () => {
    if (!selectedApp || !keyName) return;
    const result = secrets.saveSecret(selectedApp, keyName, value);
    // Clear the local plaintext from React state immediately, regardless of
    // success/failure. The state holds plaintext only for the duration of
    // the save call.
    setValue('');
    if (result.ok) {
      setStatus('Saved and re-sealed');
      timerRef.current = setTimeout(() => {
        dispatch({ type: 'GO_BACK' });
      }, 500);
    } else {
      setStatus(`Error: ${result.error}`);
    }
  };

  const handler: InputHandler = (_input, key) => {
    if (key.escape) {
      dispatch({ type: 'GO_BACK' });
      return true;
    }
    return false;
  };

  useRegisterHandler(handler);

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
              mask="*"
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
        <Text color={colors.muted}>
          {isNew
            ? 'Adding new secret. Type the key name, then the value.'
            : `Editing ${keyName} - paste new value to replace. (Current value not displayed.)`}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={colors.muted}>Enter to save | Esc to cancel</Text>
      </Box>
    </Box>
  );
}
