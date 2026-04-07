import React, { useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useRegisterHandler } from '@wrxck/ink-input-dispatcher';
import { ScrollableList } from '@wrxck/ink-scrollable-list';
import { useAvailableHeight } from '@wrxck/ink-viewport';
import type { InputHandler } from '@wrxck/ink-input-dispatcher';

import { useAppState, useAppDispatch, useRedact } from '../state.js';
import { useSecrets } from '../hooks/use-secrets.js';
import { colors } from '../theme.js';

export function SecretsView(): React.JSX.Element {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const redact = useRedact();
  const secrets = useSecrets();
  const availableHeight = useAvailableHeight();
  const { secretsSubView: subView, secretsIndex: selectedIndex, selectedApp } = state;

  const refresh = secrets.refresh;
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (subView === 'secret-list' && selectedApp) {
      secrets.loadAppSecrets(selectedApp);
    }
  }, [subView, selectedApp, secrets.loadAppSecrets]);

  const handler: InputHandler = useCallback((input, key) => {
    if (subView === 'app-list') {
      if (input === 'j' || key.downArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.min(selectedIndex + 1, secrets.apps.length - 1) });
        return true;
      }
      if (input === 'k' || key.upArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.max(selectedIndex - 1, 0) });
        return true;
      }
      if (key.return && secrets.apps[selectedIndex]) {
        dispatch({ type: 'SELECT_APP', app: secrets.apps[selectedIndex].app });
        dispatch({ type: 'SET_SECRETS_SUBVIEW', subView: 'secret-list' });
        return true;
      }
      if (input === 'u') {
        const result = secrets.unseal();
        if (!result.ok) {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unseal failed' });
        }
        secrets.refresh();
        return true;
      }
      if (input === 'l') {
        const result = secrets.seal();
        if (!result.ok) {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Seal failed' });
        }
        secrets.refresh();
        return true;
      }
    } else if (subView === 'secret-list') {
      if (input === 'j' || key.downArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.min(selectedIndex + 1, secrets.secrets.length - 1) });
        return true;
      }
      if (input === 'k' || key.upArrow) {
        dispatch({ type: 'SET_INDEX', view: 'secrets', index: Math.max(selectedIndex - 1, 0) });
        return true;
      }
      if (key.return && secrets.secrets[selectedIndex] && selectedApp) {
        dispatch({ type: 'SELECT_SECRET', key: secrets.secrets[selectedIndex].key });
        dispatch({ type: 'NAVIGATE', view: 'secret-edit' });
        return true;
      }
      if (key.escape) {
        dispatch({ type: 'SET_SECRETS_SUBVIEW', subView: 'app-list' });
        return true;
      }
      if (input === 'a' && selectedApp) {
        dispatch({ type: 'SELECT_SECRET', key: null });
        dispatch({ type: 'NAVIGATE', view: 'secret-edit' });
        return true;
      }
      if (input === 'd' && selectedApp && secrets.secrets[selectedIndex]) {
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
        return true;
      }
      if (input === 'r' && selectedApp && secrets.secrets[selectedIndex]) {
        const secretKey = secrets.secrets[selectedIndex].key;
        if (secrets.revealedValues[secretKey]) {
          secrets.hideSecret(secretKey);
        } else {
          secrets.revealSecret(selectedApp, secretKey);
        }
        return true;
      }
    }
    return false;
  }, [subView, selectedIndex, selectedApp, secrets, dispatch, redact]);

  useRegisterHandler(handler);

  const listHeight = Math.max(5, availableHeight - 5);

  return (
    <Box flexDirection="column" padding={1}>
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
          <ScrollableList
            items={secrets.apps}
            selectedIndex={Math.min(selectedIndex, secrets.apps.length - 1)}
            maxVisible={listHeight}
            emptyText="  No secrets managed"
            renderItem={(app, selected) => (
              <Box>
                <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
                <Text bold={selected} color={selected ? colors.primary : colors.text}>
                  {redact(app.app).padEnd(24)}
                </Text>
                <Text color={colors.muted}>{app.type.padEnd(14)}</Text>
                <Text>{String(app.keyCount).padEnd(8)} keys</Text>
              </Box>
            )}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text bold color={colors.primary}>{redact(selectedApp ?? '')}</Text>
          <Box marginTop={1} flexDirection="column">
            <ScrollableList
              items={secrets.secrets}
              selectedIndex={Math.min(selectedIndex, secrets.secrets.length - 1)}
              maxVisible={listHeight}
              emptyText="  No secrets found"
              renderItem={(secret, selected) => {
                const revealed = secrets.revealedValues[secret.key];
                return (
                  <Box>
                    <Text color={colors.primary}>{selected ? '> ' : '  '}</Text>
                    <Text bold={selected} color={selected ? colors.primary : colors.text}>
                      {secret.key.padEnd(30)}
                    </Text>
                    <Text color={revealed ? colors.warning : colors.muted}>
                      {revealed ?? secret.maskedValue}
                    </Text>
                  </Box>
                );
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
