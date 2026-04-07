import React from 'react';
import { Text, Box } from 'ink';

export interface SwitchProps {
  value: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
  onLabel?: string;
  offLabel?: string;
  onColor?: string;
  offColor?: string;
  disabled?: boolean;
}

const TRACK_ON = '(*)--';
const TRACK_OFF = '--(*)';

export function Switch({
  value,
  label,
  onLabel = 'ON',
  offLabel = 'OFF',
  onColor = 'green',
  offColor = 'red',
  disabled = false,
}: SwitchProps): React.ReactElement {
  const track = value ? TRACK_ON : TRACK_OFF;
  const stateLabel = value ? onLabel : offLabel;
  const color = value ? onColor : offColor;

  return (
    <Box gap={1}>
      <Text dimColor={disabled} color={disabled ? undefined : color}>
        {track}
      </Text>
      <Text dimColor={disabled}>{stateLabel}</Text>
      {label != null && <Text dimColor={disabled}>{label}</Text>}
    </Box>
  );
}
