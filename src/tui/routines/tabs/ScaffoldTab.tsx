import React, { useState } from 'react';

import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useRegisterHandler } from '@matthesketh/ink-input-dispatcher';

interface Draft {
  name: string;
  composePath: string;
  port: string;
  domain: string;
  usesSharedDb: boolean;
  nonRootUser: boolean;
}

interface Field {
  id: keyof Draft;
  label: string;
  toggle?: boolean;
}

const FIELDS: Field[] = [
  { id: 'name', label: 'app name (kebab-case)' },
  { id: 'composePath', label: 'compose path' },
  { id: 'port', label: 'public port' },
  { id: 'domain', label: 'primary domain' },
  { id: 'usesSharedDb', label: 'joins databases network?', toggle: true },
  { id: 'nonRootUser', label: 'Dockerfile USER non-root?', toggle: true },
];

function buildPlan(draft: Draft): { ok: boolean; errors: string[]; commands: string[] } {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(draft.name)) errors.push('app name: lowercase + dashes only');
  if (!draft.composePath.startsWith('/')) errors.push('compose path: absolute');
  if (!/^\d{2,5}$/.test(draft.port)) errors.push('port: 2–5 digit integer');

  if (errors.length > 0) return { ok: false, errors, commands: [] };

  const unit = `/etc/systemd/system/${draft.name}.service`;
  const commands = [
    `# 1. Scaffold the systemd unit`,
    `sudo tee ${unit} > /dev/null <<'UNIT'`,
    `[Unit]`,
    `Description=${draft.name} Docker Service`,
    `Requires=docker.service`,
    `After=docker.service network-online.target${draft.usesSharedDb ? ' docker-databases.service' : ''}`,
    `Wants=network-online.target`,
    draft.usesSharedDb ? `Requires=docker-databases.service` : '',
    ``,
    `[Service]`,
    `Type=oneshot`,
    `RemainAfterExit=yes`,
    `WorkingDirectory=${draft.composePath}`,
    `ExecStartPre=-/usr/bin/docker compose down`,
    `ExecStart=/usr/bin/docker compose up -d --force-recreate`,
    `ExecStop=/usr/bin/docker compose down`,
    `ExecReload=/usr/bin/docker compose restart`,
    `TimeoutStartSec=300`,
    `Restart=on-failure`,
    `RestartSec=10`,
    ``,
    `[Install]`,
    `WantedBy=multi-user.target`,
    `UNIT`,
    ``,
    `# 2. Daemon-reload + enable`,
    `sudo systemctl daemon-reload`,
    `sudo systemctl enable --now ${draft.name}`,
    ``,
    `# 3. Register with fleet (adds to registry.json + detects compose/ports)`,
    `fleet add ${draft.composePath}`,
    ``,
    `# 4. Nginx reverse proxy for ${draft.domain}`,
    `fleet nginx add ${draft.domain} --port ${draft.port} --type spa`,
  ];

  if (draft.usesSharedDb) {
    commands.push('', `# 5. Ensure databases network is reachable`, `docker network inspect databases > /dev/null || docker network create databases`);
  }

  if (draft.nonRootUser) {
    commands.push(
      '',
      `# 6. Guardian whitelist check (/runc must be whitelisted for non-root containers)`,
      `grep -q '^/runc$' /etc/guardian/whitelist || echo '/runc' | sudo tee -a /etc/guardian/whitelist`,
      `sudo systemctl reload guardiand || true`,
    );
  }

  return { ok: true, errors: [], commands: commands.filter(c => c !== undefined) };
}

export function ScaffoldTab(): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>({
    name: '',
    composePath: '/home/matt/',
    port: '3000',
    domain: '',
    usesSharedDb: true,
    nonRootUser: false,
  });
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [textValue, setTextValue] = useState<string>(() => String(draft[FIELDS[0].id]));
  const [plan, setPlan] = useState<ReturnType<typeof buildPlan> | null>(null);

  const currentField = FIELDS[cursor];

  useRegisterHandler((input, key) => {
    if (editing && !currentField.toggle) return false;

    if (input === 'g') {
      setPlan(buildPlan(draft));
      return true;
    }

    if (currentField.toggle && (input === ' ' || key.return)) {
      setDraft(d => ({ ...d, [currentField.id]: !d[currentField.id] }));
      return true;
    }

    if (input === 'j' || key.downArrow) {
      const next = Math.min(cursor + 1, FIELDS.length - 1);
      setCursor(next);
      if (!FIELDS[next].toggle) setTextValue(String(draft[FIELDS[next].id] ?? ''));
      setEditing(false);
      return true;
    }
    if (input === 'k' || key.upArrow) {
      const next = Math.max(cursor - 1, 0);
      setCursor(next);
      if (!FIELDS[next].toggle) setTextValue(String(draft[FIELDS[next].id] ?? ''));
      setEditing(false);
      return true;
    }
    if (input === 'e' && !currentField.toggle) {
      setEditing(true);
      return true;
    }
    return false;
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>New app scaffold</Text>
      <Text color="gray">
        answer the prompts, press `g` to generate the deployment commands. Nothing is applied automatically.
      </Text>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        {FIELDS.map((f, i) => {
          const selected = i === cursor;
          const value = draft[f.id];
          return (
            <Box key={f.id}>
              <Box width={2}><Text color={selected ? 'cyan' : undefined}>{selected ? '▶' : ' '}</Text></Box>
              <Box width={32}><Text color={selected ? 'cyan' : 'gray'}>{f.label}</Text></Box>
              {f.toggle ? (
                <Text color={value ? 'green' : 'gray'}>{value ? 'yes' : 'no'}</Text>
              ) : editing && selected ? (
                <TextInput
                  value={textValue}
                  onChange={setTextValue}
                  onSubmit={() => {
                    setDraft(prev => ({ ...prev, [f.id]: textValue }));
                    setEditing(false);
                  }}
                />
              ) : (
                <Text>{String(value)}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Text color="gray">j/k move · e edit · space toggle · g generate plan</Text>

      {plan && !plan.ok && (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red" bold>errors</Text>
          {plan.errors.map((e, i) => <Text key={i} color="red">  · {e}</Text>)}
        </Box>
      )}

      {plan?.ok && (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green" bold>deployment commands</Text>
          {plan.commands.map((line, i) => {
            const isComment = line.startsWith('#');
            return (
              <Text key={i} color={isComment ? 'gray' : undefined}>{line}</Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
