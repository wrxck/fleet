import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export type FieldType = 'text' | 'password' | 'select' | 'boolean';

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  defaultValue?: string | boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
  validate?: (value: string | boolean) => string | null;
}

export interface FormProps {
  fields: FormField[];
  onSubmit: (values: Record<string, string | boolean>) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export function Form({ fields, onSubmit, onCancel, submitLabel = 'Submit' }: FormProps): React.ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [selectIndex, setSelectIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const initial: Record<string, string | boolean> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) {
        initial[field.name] = field.defaultValue;
      } else if (field.type === 'boolean') {
        initial[field.name] = false;
      } else {
        initial[field.name] = '';
      }
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const totalItems = fields.length + 1;
  const isOnSubmitButton = activeIndex === fields.length;

  const validateAll = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      const val = values[field.name];
      if (field.required && (val === '' || val === undefined)) {
        newErrors[field.name] = `${field.label} is required`;
      }
      if (field.validate) {
        const err = field.validate(val);
        if (err) newErrors[field.name] = err;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [fields, values]);

  const setValue = useCallback((name: string, value: string | boolean) => {
    setValues(prev => ({ ...prev, [name]: value }));
    setErrors(prev => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      if (selectOpen) {
        setSelectOpen(false);
        return;
      }
      if (editing) {
        setEditing(false);
        return;
      }
      onCancel?.();
      return;
    }

    if (selectOpen && !isOnSubmitButton) {
      const field = fields[activeIndex]!;
      const opts = field.options ?? [];
      if (key.upArrow) {
        setSelectIndex(i => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectIndex(i => Math.min(opts.length - 1, i + 1));
      } else if (key.return) {
        if (opts[selectIndex]) {
          setValue(field.name, opts[selectIndex].value);
        }
        setSelectOpen(false);
        setEditing(false);
      }
      return;
    }

    if (editing && !isOnSubmitButton) {
      const field = fields[activeIndex]!;
      if (field.type === 'text' || field.type === 'password') {
        if (key.return) {
          setEditing(false);
          return;
        }
        if (key.backspace || key.delete) {
          const current = String(values[field.name] ?? '');
          setValue(field.name, current.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          const current = String(values[field.name] ?? '');
          setValue(field.name, current + input);
          return;
        }
        return;
      }
    }

    if (key.upArrow || (key.shift && key.tab)) {
      setEditing(false);
      setSelectOpen(false);
      setActiveIndex(i => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow || key.tab) {
      setEditing(false);
      setSelectOpen(false);
      setActiveIndex(i => Math.min(totalItems - 1, i + 1));
      return;
    }

    if (key.return) {
      if (isOnSubmitButton) {
        if (validateAll()) {
          onSubmit(values);
        }
        return;
      }

      const field = fields[activeIndex]!;
      if (field.type === 'boolean') {
        setValue(field.name, !values[field.name]);
        return;
      }
      if (field.type === 'select') {
        setSelectOpen(true);
        setEditing(true);
        const opts = field.options ?? [];
        const currentVal = values[field.name];
        const idx = opts.findIndex(o => o.value === currentVal);
        setSelectIndex(idx >= 0 ? idx : 0);
        return;
      }
      setEditing(true);
      return;
    }

    if (input === ' ' && !isOnSubmitButton) {
      const field = fields[activeIndex]!;
      if (field.type === 'boolean') {
        setValue(field.name, !values[field.name]);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {fields.map((field, index) => {
        const isActive = index === activeIndex;
        const error = errors[field.name];
        const val = values[field.name];

        return (
          <Box key={field.name} flexDirection="column">
            <Box>
              <Text color={isActive ? 'cyan' : undefined} bold={isActive}>
                {isActive ? '> ' : '  '}
                {field.label}
                {field.required ? ' *' : ''}
                {': '}
              </Text>
              {field.type === 'boolean' ? (
                <Text color={isActive ? 'cyan' : undefined}>
                  {val ? '[x]' : '[ ]'}
                </Text>
              ) : field.type === 'password' ? (
                <Text color={isActive ? 'cyan' : undefined}>
                  {String(val || '').length > 0
                    ? '*'.repeat(String(val).length)
                    : (field.placeholder && !editing ? field.placeholder : '')}
                  {isActive && editing ? '_' : ''}
                </Text>
              ) : field.type === 'select' ? (
                <Text color={isActive ? 'cyan' : undefined}>
                  {(() => {
                    const opt = field.options?.find(o => o.value === val);
                    return opt ? opt.label : (field.placeholder ?? '');
                  })()}
                  {isActive && !selectOpen ? ' v' : ''}
                </Text>
              ) : (
                <Text color={isActive ? 'cyan' : undefined}>
                  {String(val || '') || (field.placeholder && !editing ? field.placeholder : '')}
                  {isActive && editing ? '_' : ''}
                </Text>
              )}
            </Box>
            {selectOpen && isActive && field.type === 'select' && (
              <Box flexDirection="column" marginLeft={4}>
                {(field.options ?? []).map((opt, oi) => (
                  <Text key={opt.value} color={oi === selectIndex ? 'cyan' : undefined}>
                    {oi === selectIndex ? '> ' : '  '}{opt.label}
                  </Text>
                ))}
              </Box>
            )}
            {error && (
              <Text color="red">  {error}</Text>
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={isOnSubmitButton ? 'cyan' : undefined} bold={isOnSubmitButton}>
          {isOnSubmitButton ? '> ' : '  '}[ {submitLabel} ]
        </Text>
      </Box>
    </Box>
  );
}
