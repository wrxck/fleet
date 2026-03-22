import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { useSecrets } from '../hooks/use-secrets.js';
import { colors } from '../theme.js';

type SecretsSubView = 'app-list' | 'secret-list';

export function SecretsView(): React.JSX.Element {
  const { selectedApp } = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const secrets = useSecrets();
  const [subView, setSubView] = useState<SecretsSubView>('app-list');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    secrets.refresh();
  }, []);

  useEffect(() => {
    if (subView === 'secret-list' && selectedApp) {
      secrets.loadAppSecrets(selectedApp);
    }
  }, [subView, selectedApp]);

  useInput((input, key) => {
    if (subView === 'app-list') {
      if (input === 'j' || key.downArrow) {
        setSelectedIndex(prev => Math.min(prev + 1, secrets.apps.length - 1));
      } else if (input === 'k' || key.upArrow) {
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (key.return && secrets.apps[selectedIndex]) {
        dispatch({ type: 'SELECT_APP', app: secrets.apps[selectedIndex].app });
        setSubView('secret-list');
        setSelectedIndex(0);
      } else if (input === 'u') {
        const result = secrets.unseal();
        if (!result.ok) {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unseal failed' });
        }
        secrets.refresh();
      } else if (input === 'l') {
        const result = secrets.seal();
        if (!result.ok) {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Seal failed' });
        }
        secrets.refresh();
      }
    } else if (subView === 'secret-list') {
      if (input === 'j' || key.downArrow) {
        setSelectedIndex(prev => Math.min(prev + 1, secrets.secrets.length - 1));
      } else if (input === 'k' || key.upArrow) {
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (key.return && secrets.secrets[selectedIndex] && selectedApp) {
        dispatch({ type: 'SELECT_SECRET', key: secrets.secrets[selectedIndex].key });
        dispatch({ type: 'NAVIGATE', view: 'secret-edit' });
      } else if (key.escape) {
        setSubView('app-list');
        setSelectedIndex(0);
      } else if (input === 'a' && selectedApp) {
        dispatch({ type: 'SELECT_SECRET', key: null });
        dispatch({ type: 'NAVIGATE', view: 'secret-edit' });
      } else if (input === 'd' && selectedApp && secrets.secrets[selectedIndex]) {
        const secretKey = secrets.secrets[selectedIndex].key;
        dispatch({
          type: 'CONFIRM',
          action: {
            label: `Delete secret "${secretKey}"?`,
            description: `This will remove ${secretKey} from ${redact(selectedApp)}'s vault.`,
            onConfirm: () => {
              const result = secrets.deleteSecret(selectedApp, secretKey);
              if (result.ok) {
                secrets.loadAppSecrets(selectedApp);
                secrets.refresh();
              } else {
                dispatch({ type: 'SET_ERROR', error: result.error ?? 'Delete failed' });
              }
            },
          },
        });
      } else if (input === 'r' && selectedApp && secrets.secrets[selectedIndex]) {
        const secretKey = secrets.secrets[selectedIndex].key;
        if (secrets.revealedValues[secretKey]) {
          secrets.hideSecret(secretKey);
        } else {
          secrets.revealSecret(selectedApp, secretKey);
        }
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Vault status banner */}
      <Box marginBottom={1} paddingX={1} gap={2}>
        <Text bold>Vault:</Text>
        {!secrets.initialized ? (
          <Text color={colors.error}>Not initialized</Text>
        ) : secrets.sealed ? (
          <Text color={colors.warning} bold>SEALED</Text>
        ) : (
          <Text color={colors.success} bold>UNSEALED</Text>
        )}
        <Text color={colors.muted}>
          {secrets.apps.length} apps | {secrets.apps.reduce((sum, a) => sum + a.keyCount, 0)} keys
        </Text>
      </Box>

      {secrets.error && (
        <Box marginBottom={1}>
          <Text color={colors.error}>{secrets.error}</Text>
        </Box>
      )}

      {subView === 'app-list' ? (
        <Box flexDirection="column">
          <Text bold>Apps with secrets:</Text>
          {secrets.apps.length === 0 ? (
            <Text color={colors.muted}>  No secrets managed</Text>
          ) : (
            secrets.apps.map((app, i) => {
              const selected = i === selectedIndex;
              return (
                <Text key={app.app}>
                  <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
                  <Text bold={selected} color={selected ? colors.primary : colors.text}>
                    {redact(app.app).padEnd(24)}
                  </Text>
                  <Text color={colors.muted}>{app.type.padEnd(14)}</Text>
                  <Text>{String(app.keyCount).padEnd(8)} keys</Text>
                </Text>
              );
            })
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text bold color={colors.primary}>{redact(selectedApp ?? '')}</Text>
          <Box marginTop={1} flexDirection="column">
            {secrets.secrets.length === 0 ? (
              <Text color={colors.muted}>  No secrets found</Text>
            ) : (
              secrets.secrets.map((secret, i) => {
                const selected = i === selectedIndex;
                const revealed = secrets.revealedValues[secret.key];
                return (
                  <Text key={secret.key}>
                    <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
                    <Text bold={selected} color={selected ? colors.primary : colors.text}>
                      {secret.key.padEnd(30)}
                    </Text>
                    <Text color={revealed ? colors.warning : colors.muted}>
                      {revealed ?? secret.maskedValue}
                    </Text>
                  </Text>
                );
              })
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
