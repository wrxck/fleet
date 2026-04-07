import React from 'react';
import { Text, Box } from 'ink';
import { Modal } from '@wrxck/ink-modal';

import { useAppState } from '../state.js';
import { colors } from '../theme.js';

export function Confirm(): React.JSX.Element | null {
  const { confirmAction } = useAppState();

  return (
    <Modal
      visible={confirmAction !== null}
      title={confirmAction?.label}
      borderColor={colors.warning}
      width={50}
      footer={
        <Box gap={2}>
          <Text><Text bold color={colors.success}>y</Text> confirm</Text>
          <Text><Text bold color={colors.error}>n</Text> cancel</Text>
        </Box>
      }
    >
      <Text color={colors.muted}>{confirmAction?.description ?? ''}</Text>
    </Modal>
  );
}
