import React, { useState } from 'react';

import { Box, Text } from 'ink';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import TextInput from 'ink-text-input';

import { RoutineSchema, type Routine } from '../../../core/routines/schema.js';

export interface RoutineFormProps {
  initial?: Routine;
  onSubmit(r: Routine): void;
  onCancel(): void;
}

type FieldId =
  | 'id'
  | 'name'
  | 'description'
  | 'scheduleKind'
  | 'onCalendar'
  | 'taskKind'
  | 'prompt'
  | 'argv'
  | 'tool'
  | 'tokenCap'
  | 'maxUsd'
  | 'enabled';

type ScheduleKindSelect = 'manual' | 'calendar';

type TaskKindSelect = 'claude-cli' | 'shell' | 'mcp-call';

interface DraftState {
  id: string;
  name: string;
  description: string;
  scheduleKind: ScheduleKindSelect;
  onCalendar: string;
  taskKind: TaskKindSelect;
  prompt: string;
  argv: string;
  tool: string;
  tokenCap: string;
  maxUsd: string;
  enabled: boolean;
}

function toDraft(r?: Routine): DraftState {
  if (!r) {
    return {
      id: '',
      name: '',
      description: '',
      scheduleKind: 'calendar',
      onCalendar: '*-*-* 02:00:00',
      taskKind: 'claude-cli',
      prompt: '',
      argv: '',
      tool: '',
      tokenCap: '100000',
      maxUsd: '2',
      enabled: false,
    };
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    scheduleKind: r.schedule.kind === 'calendar' ? 'calendar' : 'manual',
    onCalendar: r.schedule.kind === 'calendar' ? r.schedule.onCalendar : '*-*-* 02:00:00',
    taskKind: r.task.kind,
    prompt: r.task.kind === 'claude-cli' ? r.task.prompt : '',
    argv: r.task.kind === 'shell' ? r.task.argv.join(' ') : '',
    tool: r.task.kind === 'mcp-call' ? r.task.tool : '',
    tokenCap: r.task.kind === 'claude-cli' ? String(r.task.tokenCap) : '100000',
    maxUsd: r.task.kind === 'claude-cli' ? String(r.task.maxUsd) : '2',
    enabled: r.enabled,
  };
}

function buildRoutine(draft: DraftState): { ok: true; routine: Routine } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const trimmed = {
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    description: draft.description.trim(),
    onCalendar: draft.onCalendar.trim(),
    prompt: draft.prompt.trim(),
    argv: draft.argv.trim(),
    tool: draft.tool.trim(),
    tokenCap: parseInt(draft.tokenCap, 10),
    maxUsd: parseFloat(draft.maxUsd),
  };

  if (!trimmed.id) errors.push('id is required');
  if (draft.scheduleKind === 'calendar' && !trimmed.onCalendar) errors.push('OnCalendar is required for calendar schedule');

  let task: Routine['task'];
  if (draft.taskKind === 'claude-cli') {
    if (!trimmed.prompt) errors.push('prompt is required for claude-cli task');
    if (!Number.isFinite(trimmed.tokenCap) || trimmed.tokenCap <= 0) errors.push('tokenCap must be a positive integer');
    if (!Number.isFinite(trimmed.maxUsd) || trimmed.maxUsd <= 0) errors.push('maxUsd must be positive');
    task = {
      kind: 'claude-cli',
      prompt: trimmed.prompt,
      outputFormat: 'json',
      tokenCap: trimmed.tokenCap,
      maxUsd: trimmed.maxUsd,
      wallClockMs: 15 * 60 * 1000,
    };
  } else if (draft.taskKind === 'shell') {
    const argv = trimmed.argv.length > 0 ? trimmed.argv.split(/\s+/) : [];
    if (argv.length === 0) errors.push('argv is required for shell task');
    task = { kind: 'shell', argv, wallClockMs: 15 * 60 * 1000 };
  } else {
    if (!trimmed.tool) errors.push('tool is required for mcp-call task');
    task = { kind: 'mcp-call', tool: trimmed.tool, args: {}, wallClockMs: 60_000 };
  }

  if (errors.length > 0) return { ok: false, errors };

  const candidate = {
    id: trimmed.id,
    name: trimmed.name || trimmed.id,
    description: trimmed.description,
    schedule: draft.scheduleKind === 'manual'
      ? { kind: 'manual' as const }
      : { kind: 'calendar' as const, onCalendar: trimmed.onCalendar, randomizedDelaySec: 300, persistent: true },
    enabled: draft.enabled,
    targets: [],
    perTarget: false,
    task,
    notify: [],
    tags: [],
  };

  const parsed = RoutineSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  }
  return { ok: true, routine: parsed.data };
}

const FIELD_ORDER_ALL: FieldId[] = [
  'id', 'name', 'description',
  'scheduleKind', 'onCalendar',
  'taskKind', 'prompt', 'argv', 'tool', 'tokenCap', 'maxUsd',
  'enabled',
];

function visibleFields(draft: DraftState): FieldId[] {
  return FIELD_ORDER_ALL.filter(f => {
    if (f === 'onCalendar' && draft.scheduleKind !== 'calendar') return false;
    if (f === 'prompt' && draft.taskKind !== 'claude-cli') return false;
    if (f === 'tokenCap' && draft.taskKind !== 'claude-cli') return false;
    if (f === 'maxUsd' && draft.taskKind !== 'claude-cli') return false;
    if (f === 'argv' && draft.taskKind !== 'shell') return false;
    if (f === 'tool' && draft.taskKind !== 'mcp-call') return false;
    return true;
  });
}

const FIELD_LABEL: Record<FieldId, string> = {
  id: 'id',
  name: 'name',
  description: 'description',
  scheduleKind: 'schedule',
  onCalendar: 'OnCalendar',
  taskKind: 'task kind',
  prompt: 'prompt',
  argv: 'argv',
  tool: 'MCP tool',
  tokenCap: 'token cap',
  maxUsd: 'max USD',
  enabled: 'enabled',
};

export function RoutineForm({ initial, onSubmit, onCancel }: RoutineFormProps): React.JSX.Element {
  const [draft, setDraft] = useState<DraftState>(() => toDraft(initial));
  const [cursor, setCursor] = useState(0);
  const [textValue, setTextValue] = useState<string>(() => {
    const fields = visibleFields(draft);
    return (draft as unknown as Record<FieldId, string | boolean>)[fields[0]] as string;
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState(true);

  const fields = visibleFields(draft);
  const currentField = fields[cursor];
  const isDisabledId = !!initial;

  useRegisterHandler((input, key) => {
    if (editing && (currentField === 'scheduleKind' || currentField === 'taskKind' || currentField === 'enabled')) {
      return false;
    }

    if (key.escape) {
      onCancel();
      return true;
    }

    if (!editing) {
      if (key.return) {
        const result = buildRoutine(draft);
        if (!result.ok) {
          setErrors(result.errors);
          return true;
        }
        onSubmit(result.routine);
        return true;
      }
      if (input === 'e') {
        setEditing(true);
        return true;
      }
      if (input === 'j' || key.downArrow) {
        const next = Math.min(cursor + 1, fields.length - 1);
        setCursor(next);
        const nextField = fields[next];
        if (nextField !== 'scheduleKind' && nextField !== 'taskKind' && nextField !== 'enabled') {
          setTextValue(String((draft as unknown as Record<FieldId, string | boolean>)[nextField] ?? ''));
        }
        return true;
      }
      if (input === 'k' || key.upArrow) {
        const next = Math.max(cursor - 1, 0);
        setCursor(next);
        const nextField = fields[next];
        if (nextField !== 'scheduleKind' && nextField !== 'taskKind' && nextField !== 'enabled') {
          setTextValue(String((draft as unknown as Record<FieldId, string | boolean>)[nextField] ?? ''));
        }
        return true;
      }
      return false;
    }

    if (currentField === 'scheduleKind') {
      if (input === ' ' || key.return) {
        setDraft(d => ({ ...d, scheduleKind: d.scheduleKind === 'manual' ? 'calendar' : 'manual' }));
        return true;
      }
    }
    if (currentField === 'taskKind') {
      if (input === ' ' || key.return) {
        setDraft(d => {
          const next: Record<TaskKindSelect, TaskKindSelect> = {
            'claude-cli': 'shell',
            'shell': 'mcp-call',
            'mcp-call': 'claude-cli',
          };
          return { ...d, taskKind: next[d.taskKind] };
        });
        return true;
      }
    }
    if (currentField === 'enabled') {
      if (input === ' ' || key.return) {
        setDraft(d => ({ ...d, enabled: !d.enabled }));
        return true;
      }
    }
    return false;
  });

  const renderField = (f: FieldId, selected: boolean): React.JSX.Element => {
    const marker = selected ? '▶' : ' ';
    const label = FIELD_LABEL[f];
    const editable = editing && selected && f !== 'scheduleKind' && f !== 'taskKind' && f !== 'enabled';
    const d = draft as unknown as Record<FieldId, string | boolean>;

    const valueNode = ((): React.JSX.Element => {
      if (editable && typeof d[f] === 'string') {
        return (
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={() => {
              setDraft(prev => ({ ...prev, [f]: textValue } as DraftState));
              setEditing(false);
            }}
          />
        );
      }
      if (f === 'enabled') return <Text color={draft.enabled ? 'green' : 'gray'}>{draft.enabled ? 'yes' : 'no'}</Text>;
      if (f === 'scheduleKind') return <Text color="cyan">{draft.scheduleKind}</Text>;
      if (f === 'taskKind') return <Text color="cyan">{draft.taskKind}</Text>;
      if (f === 'id' && isDisabledId) return <Text color="gray">{String(d[f])} (locked)</Text>;
      return <Text>{String(d[f])}</Text>;
    })();

    return (
      <Box key={f}>
        <Box width={2}><Text color={selected ? 'cyan' : undefined}>{marker}</Text></Box>
        <Box width={16}><Text color={selected ? 'cyan' : 'gray'}>{label}</Text></Box>
        <Box>{valueNode}</Box>
      </Box>
    );
  };

  const hint = editing && currentField !== 'scheduleKind' && currentField !== 'taskKind' && currentField !== 'enabled'
    ? 'type to edit · Enter to confirm field · Esc cancel'
    : editing
      ? 'Space/Enter to toggle · Esc cancel'
      : 'j/k move · e edit · Enter submit · Esc cancel';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} gap={1}>
      <Text bold color="cyan">{initial ? `edit ${initial.id}` : 'new routine'}</Text>
      <Box flexDirection="column">
        {fields.map((f, i) => renderField(f, i === cursor))}
      </Box>
      {errors.length > 0 && (
        <Box flexDirection="column">
          <Text color="red" bold>errors</Text>
          {errors.map((e, i) => <Text key={i} color="red">  · {e}</Text>)}
        </Box>
      )}
      <Text color="gray">{hint}</Text>
    </Box>
  );
}
