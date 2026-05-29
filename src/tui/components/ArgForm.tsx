import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { z } from 'zod';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';

import { colors } from '../theme';

interface Field {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'enum';
  options?: string[];
}

function describeField(name: string, schema: z.ZodTypeAny): Field {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault) {
    s = s._def.innerType as z.ZodTypeAny;
  }
  if (s instanceof z.ZodBoolean) return { name, kind: 'boolean' };
  if (s instanceof z.ZodNumber) return { name, kind: 'number' };
  if (s instanceof z.ZodEnum) return { name, kind: 'enum', options: s._def.values as string[] };
  return { name, kind: 'string' };
}

export function ArgForm(props: {
  schema: z.ZodObject<z.ZodRawShape>;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const fields: Field[] = Object.entries(props.schema.shape).map(([n, s]) =>
    describeField(n, s as z.ZodTypeAny),
  );
  const [cursor, setCursor] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map(f => [f.name, f.kind === 'boolean' ? false : ''])),
  );

  const handler: InputHandler = (input, key) => {
    if (key.escape) { props.onCancel(); return true; }
    if (key.return) { props.onSubmit(values); return true; }
    if (key.downArrow) { setCursor(c => Math.min(c + 1, fields.length - 1)); return true; }
    if (key.upArrow) { setCursor(c => Math.max(c - 1, 0)); return true; }
    const field = fields[cursor];
    if (!field) return false;
    if (field.kind === 'boolean') {
      if (input === ' ') { setValues(v => ({ ...v, [field.name]: !v[field.name] })); return true; }
    } else if (key.backspace || key.delete) {
      setValues(v => ({ ...v, [field.name]: String(v[field.name] ?? '').slice(0, -1) }));
      return true;
    } else if (input && !key.ctrl && !key.meta) {
      setValues(v => ({ ...v, [field.name]: String(v[field.name] ?? '') + input }));
      return true;
    }
    return false;
  };
  useRegisterHandler(handler);

  return (
    <Box flexDirection="column">
      {fields.map((f, i) => (
        <Box key={f.name}>
          <Text color={i === cursor ? colors.primary : colors.muted}>
            {i === cursor ? '> ' : '  '}{f.name}:{' '}
          </Text>
          <Text>
            {f.kind === 'boolean'
              ? (values[f.name] ? '[x]' : '[ ]')
              : String(values[f.name] ?? '')}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={colors.muted}>↑↓ field · space toggle · enter run · esc cancel</Text>
      </Box>
    </Box>
  );
}
