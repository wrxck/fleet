import React, { useState, useCallback, useMemo } from 'react';

import { Text, useInput } from 'ink';

export interface MaskedInputProps {
  mask: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
}

type MaskCharType = 'digit' | 'letter' | 'any' | 'literal';

interface MaskSlot {
  type: MaskCharType;
  literal?: string;
}

function parseMask(mask: string): MaskSlot[] {
  return [...mask].map((ch): MaskSlot => {
    switch (ch) {
      case '9': return { type: 'digit' };
      case 'a': return { type: 'letter' };
      case '*': return { type: 'any' };
      default:  return { type: 'literal', literal: ch };
    }
  });
}

function matchesSlot(ch: string, slot: MaskSlot): boolean {
  switch (slot.type) {
    case 'digit':  return /^[0-9]$/.test(ch);
    case 'letter': return /^[a-zA-Z]$/.test(ch);
    case 'any':    return ch.length === 1;
    case 'literal': return false;
  }
}

// finds the next editable (non-literal) position at or after `pos`
function nextEditablePos(slots: MaskSlot[], pos: number): number {
  while (pos < slots.length && slots[pos]!.type === 'literal') {
    pos++;
  }
  return pos;
}

// finds the previous editable (non-literal) position before `pos`
function prevEditablePos(slots: MaskSlot[], pos: number): number {
  pos--;
  while (pos >= 0 && slots[pos]!.type === 'literal') {
    pos--;
  }
  return pos;
}

// converts the internal filled array back to a raw value string
function filledToValue(filled: (string | null)[], slots: MaskSlot[]): string {
  return filled
    .filter((_, i) => slots[i]!.type !== 'literal')
    .map(ch => ch ?? '')
    .join('');
}

// expands a raw value string into the filled array
function valueToFilled(value: string, slots: MaskSlot[]): (string | null)[] {
  const filled: (string | null)[] = slots.map(s => s.type === 'literal' ? s.literal! : null);
  let vi = 0;
  for (let i = 0; i < slots.length && vi < value.length; i++) {
    if (slots[i]!.type !== 'literal') {
      const ch = value[vi]!;
      if (matchesSlot(ch, slots[i]!)) {
        filled[i] = ch;
      }
      vi++;
    }
  }
  return filled;
}

export function MaskedInput({
  mask,
  value,
  onChange,
  onSubmit,
  placeholder: _placeholder,
  focus = true,
}: MaskedInputProps): React.ReactElement {
  const slots = useMemo(() => parseMask(mask), [mask]);
  const filled = useMemo(() => valueToFilled(value, slots), [value, slots]);

  // cursor position tracks the next editable slot to fill
  const [cursorPos, setCursorPos] = useState(() => {
    // find first unfilled editable position
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]!.type !== 'literal' && filled[i] == null) {
        return i;
      }
    }
    return slots.length;
  });

  const allFilled = useMemo(
    () => filled.every((ch, i) => slots[i]!.type === 'literal' || ch != null),
    [filled, slots],
  );

  const handleInput = useCallback(
    (input: string, key: { return?: boolean; backspace?: boolean; delete?: boolean }) => {
      if (key.return) {
        if (allFilled && onSubmit) {
          onSubmit(filledToValue(filled, slots));
        }
        return;
      }

      if (key.backspace || key.delete) {
        const prev = prevEditablePos(slots, cursorPos);
        if (prev < 0) return;
        const newFilled = [...filled];
        newFilled[prev] = null;
        setCursorPos(prev);
        onChange(filledToValue(newFilled, slots));
        return;
      }

      if (!input || input.length !== 1) return;

      // find the actual editable position at or after cursor
      const pos = nextEditablePos(slots, cursorPos);
      if (pos >= slots.length) return;

      if (!matchesSlot(input, slots[pos]!)) return;

      const newFilled = [...filled];
      newFilled[pos] = input;
      const nextPos = nextEditablePos(slots, pos + 1);
      setCursorPos(nextPos);
      onChange(filledToValue(newFilled, slots));
    },
    [filled, slots, cursorPos, allFilled, onChange, onSubmit],
  );

  useInput(handleInput, { isActive: focus });

  // render the display string
  const display = slots
    .map((slot, i) => {
      if (slot.type === 'literal') return slot.literal!;
      return filled[i] ?? '_';
    })
    .join('');

  return <Text>{display}</Text>;
}
