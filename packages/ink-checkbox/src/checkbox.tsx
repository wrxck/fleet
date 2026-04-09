import React from 'react';
import { Text } from 'ink';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  color?: string;
  disabled?: boolean;
}

const CHECKED_ICON = '\u2611';
const UNCHECKED_ICON = '\u2610';

export function Checkbox({
  label,
  checked,
  onChange,
  color = 'cyan',
  disabled = false,
}: CheckboxProps) {
  const indicator = checked ? CHECKED_ICON : UNCHECKED_ICON;

  if (disabled) {
    return (
      <Text dimColor>
        {indicator} {label}
      </Text>
    );
  }

  return (
    <Text>
      {checked ? (
        <Text color={color}>{indicator}</Text>
      ) : (
        <Text dimColor>{indicator}</Text>
      )}
      {' '}
      {checked ? <Text bold>{label}</Text> : <Text>{label}</Text>}
    </Text>
  );
}
