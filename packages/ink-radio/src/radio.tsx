import React from 'react';
import { Box, Text } from 'ink';

export interface RadioOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  direction?: 'vertical' | 'horizontal';
  color?: string;
}

const SELECTED = '\u25C9';
const UNSELECTED = '\u25CB';

export function RadioGroup({
  options,
  value,
  onChange: _onChange,
  direction = 'vertical',
  color = 'cyan',
}: RadioGroupProps): React.ReactElement {
  return (
    <Box flexDirection={direction === 'vertical' ? 'column' : 'row'} gap={direction === 'horizontal' ? 1 : 0}>
      {options.map((option) => {
        const isSelected = option.value === value;
        const symbol = isSelected ? SELECTED : UNSELECTED;

        return (
          <Box key={option.value}>
            <Text
              bold={isSelected}
              color={option.disabled ? undefined : isSelected ? color : undefined}
              dimColor={option.disabled}
            >
              {symbol} {option.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
