import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';
import type { InputHandler } from '@matthesketh/ink-input-dispatcher';
import { ScrollableList } from '@matthesketh/ink-scrollable-list';

import { loadRegistry } from '../../registry/index';
import { allCommands } from '../../registry/registry';
import type { CommandDef } from '../../registry/types';
import { ArgForm } from '../components/ArgForm';
import { runFleetCommand } from '../exec-bridge';
import { colors } from '../theme';

export function CommandPalette(props: {
  onOpenView: (view: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  // load the registry once and snapshot the visible commands. a lazy useState
  // initialiser runs exactly once — unlike a bare call in the render body.
  const [commands] = useState<CommandDef[]>(() => {
    loadRegistry();
    return allCommands().filter(c => !c.cliOnly);
  });
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<CommandDef | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const filtered = useMemo(
    () => commands.filter(c => (c.name + ' ' + c.summary).toLowerCase().includes(query.toLowerCase())),
    [commands, query],
  );

  const listHandler: InputHandler = (input, key) => {
    if (chosen || output !== null) return false;
    if (key.escape) { props.onClose(); return true; }
    if (key.downArrow) { setIndex(i => Math.min(i + 1, filtered.length - 1)); return true; }
    if (key.upArrow) { setIndex(i => Math.max(i - 1, 0)); return true; }
    if (key.return) {
      const cmd = filtered[index];
      if (!cmd) return true;
      if (cmd.tui && typeof cmd.tui === 'object') { props.onOpenView(cmd.tui.view); return true; }
      setChosen(cmd);
      return true;
    }
    if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); setIndex(0); return true; }
    if (input && !key.ctrl && !key.meta) { setQuery(q => q + input); setIndex(0); return true; }
    return false;
  };
  useRegisterHandler(listHandler);

  if (output !== null) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>{chosen?.name} result</Text>
        <Text>{output}</Text>
        <Text color={colors.muted}>esc to close</Text>
        <CloseOnEscape onClose={() => { setOutput(null); setChosen(null); }} />
      </Box>
    );
  }

  if (chosen) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors.primary}>{chosen.name}</Text>
        <ArgForm
          schema={chosen.args}
          onCancel={() => setChosen(null)}
          onSubmit={async values => {
            const argv = [chosen.name];
            for (const [k, v] of Object.entries(values)) {
              if (v === true) argv.push(`--${k}`);
              else if (v !== false && v !== '' && v != null) argv.push(`--${k}`, String(v));
            }
            const r = await runFleetCommand(argv);
            setOutput(r.output);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={colors.primary}>Command palette</Text>
      <Text color={colors.muted}>filter: {query || '(type to filter)'}</Text>
      <ScrollableList
        items={filtered}
        selectedIndex={Math.min(index, Math.max(0, filtered.length - 1))}
        maxVisible={12}
        emptyText="  no matching commands"
        renderItem={(cmd, selected) => (
          <Box>
            <Text color={selected ? colors.primary : colors.muted}>{selected ? '> ' : '  '}</Text>
            <Box width={20}><Text bold={selected}>{cmd.name}</Text></Box>
            <Text color={colors.muted}>{cmd.summary}</Text>
          </Box>
        )}
      />
    </Box>
  );
}

function CloseOnEscape(props: { onClose: () => void }): React.JSX.Element {
  const handler: InputHandler = (_input, key) => {
    if (key.escape) { props.onClose(); return true; }
    return false;
  };
  useRegisterHandler(handler);
  return <></>;
}
