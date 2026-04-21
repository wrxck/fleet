import React from 'react';

import { Box, Text } from 'ink';

import { dbPath } from '@/core/routines/db.js';
import type { RoutinesRuntime } from '@/tui/routines/runtime.js';

export interface SettingsTabProps {
  runtime: RoutinesRuntime;
}

interface KeyGroup {
  title: string;
  bindings: { key: string; label: string }[];
}

const KEY_GROUPS: KeyGroup[] = [
  {
    title: 'Navigation',
    bindings: [
      { key: '1..8', label: 'jump to numbered tab' },
      { key: 'j / k  or  ↓ / ↑', label: 'move cursor' },
      { key: 'Enter', label: 'drill in / select' },
      { key: 'Esc', label: 'back / cancel modal' },
      { key: 'p  or  Ctrl+K', label: 'command palette' },
      { key: 'q', label: 'quit' },
    ],
  },
  {
    title: 'Routines',
    bindings: [
      { key: 'n', label: 'new routine' },
      { key: 'e', label: 'edit selected' },
      { key: 'd', label: 'delete selected (y/n confirm)' },
      { key: 't', label: 'toggle enabled' },
      { key: 'r', label: 'run now (opens live panel)' },
    ],
  },
  {
    title: 'Dashboard / Ops',
    bindings: [
      { key: 'r', label: 'force refresh signals' },
      { key: 'Enter', label: 'drill into repo detail' },
    ],
  },
  {
    title: 'Logs',
    bindings: [
      { key: 'j / k', label: 'pick service' },
      { key: 'Enter', label: 'tail selected' },
      { key: 'w', label: 'toggle warn filter' },
      { key: 'x', label: 'toggle error filter' },
      { key: 'c', label: 'clear filter' },
      { key: 'Esc', label: 'stop tail' },
    ],
  },
  {
    title: 'Live-run panel',
    bindings: [
      { key: 'a', label: 'abort running task' },
      { key: 'Esc / Enter / q', label: 'close after end' },
    ],
  },
];

function Row({ label, value, color }: { label: string; value: React.ReactNode; color?: string }): React.JSX.Element {
  return (
    <Box>
      <Box width={26}><Text color="gray">  {label}</Text></Box>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

export function SettingsTab({ runtime }: SettingsTabProps): React.JSX.Element {
  const routinesCount = runtime.store.list().length;
  const enabledCount = runtime.store.list().filter(r => r.enabled).length;
  const storePath = runtime.store.storePath();
  const databasePath = dbPath();

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Settings & reference</Text>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Runtime</Text>
        <Row label="fleet version" value="1.4.0" />
        <Row label="ink" value="5.2.1" />
        <Row label="react" value="18.3.1" />
        <Row label="routines loaded" value={`${routinesCount} (${enabledCount} enabled)`} />
        <Row label="defaults seeded" value={runtime.seeded.seeded > 0 ? `${runtime.seeded.seeded} new` : 'already in place'} color={runtime.seeded.seeded > 0 ? 'magenta' : 'gray'} />
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Paths</Text>
        <Row label="routines.json" value={storePath} />
        <Row label="fleet.db" value={databasePath} />
        <Row label="unit template dir" value="/etc/systemd/system" />
        <Row label="mutex / config dir" value="/var/lib/fleet/locks  ·  /var/lib/fleet/claude-configs" />
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Adapters enabled</Text>
        <Row label="scheduler" value="systemd-timer" color="green" />
        <Row label="runners" value="shell · claude-cli · mcp-call" color="green" />
        <Row label="notifiers" value="stdout" color="green" />
        <Row label="signals" value="git-clean · container-up · ci-status" color="green" />
      </Box>

      {KEY_GROUPS.map(group => (
        <Box key={group.title} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Text bold>{group.title}</Text>
          {group.bindings.map(b => (
            <Box key={b.key}>
              <Box width={26}><Text color="cyan">  {b.key}</Text></Box>
              <Text color="gray">{b.label}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
