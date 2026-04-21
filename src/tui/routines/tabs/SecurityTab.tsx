import React from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { AppEntry } from '@/core/registry.js';
import { formatRelative, truncate } from '@/tui/routines/format.js';
import { useSecurity, type CertExpiry } from '@/tui/routines/hooks/use-security.js';

export interface SecurityTabProps {
  apps: AppEntry[];
}

function certColor(c: CertExpiry): string {
  if (c.daysUntil == null) return 'gray';
  if (c.daysUntil <= 7) return 'red';
  if (c.daysUntil <= 30) return 'yellow';
  return 'green';
}

function ageColor(days: number | null): string {
  if (days == null) return 'gray';
  if (days >= 180) return 'red';
  if (days >= 90) return 'yellow';
  return 'green';
}

export function SecurityTab({ apps }: SecurityTabProps): React.JSX.Element {
  const snap = useSecurity(apps);

  const expiringSoon = snap.certs.filter(c => c.daysUntil != null && c.daysUntil <= 30).length;
  const rotationsDue = snap.secretAges.filter(s => s.ageDays != null && s.ageDays >= 90).length;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold>Security overview</Text>
        <Text color={expiringSoon > 0 ? 'yellow' : 'green'}>{expiringSoon} certs expiring ≤30d</Text>
        <Text color={rotationsDue > 0 ? 'yellow' : 'green'}>{rotationsDue} secrets overdue for rotation</Text>
        {snap.loading ? (
          <Text color="cyan"><Spinner type="dots" /> refreshing</Text>
        ) : (
          <Text color="gray">updated {formatRelative(new Date(snap.refreshedAt).toISOString())}</Text>
        )}
      </Box>

      <Box flexDirection="row" gap={4}>
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={48}>
          <Text bold>Guardian</Text>
          {!snap.guardian ? (
            <Text color="gray">  —</Text>
          ) : (
            <>
              <Box>
                <Box width={18}><Text color="gray">  binary</Text></Box>
                <Text color={snap.guardian.binaryInstalled ? 'green' : 'red'}>
                  {snap.guardian.binaryInstalled ? 'installed' : 'missing'}
                </Text>
              </Box>
              <Box>
                <Box width={18}><Text color="gray">  whitelist</Text></Box>
                <Text color={snap.guardian.whitelistExists ? 'green' : 'red'}>
                  {snap.guardian.whitelistExists
                    ? `${snap.guardian.whitelistLines ?? '?'} entries`
                    : 'missing'}
                </Text>
              </Box>
              <Box>
                <Box width={18}><Text color="gray">  /runc whitelisted</Text></Box>
                <Text color={snap.guardian.runcWhitelisted ? 'green' : 'red'}>
                  {snap.guardian.runcWhitelisted ? 'yes' : snap.guardian.runcWhitelisted === false ? 'NO — containers at risk' : '—'}
                </Text>
              </Box>
            </>
          )}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={48}>
          <Text bold>SSH agent</Text>
          {!snap.ssh ? (
            <Text color="gray">  —</Text>
          ) : (
            <>
              <Box>
                <Box width={18}><Text color="gray">  socket</Text></Box>
                <Text color={snap.ssh.socketExists ? 'green' : 'red'}>
                  {snap.ssh.socketExists ? '/tmp/fleet-ssh-agent.sock' : 'not present'}
                </Text>
              </Box>
              <Box>
                <Box width={18}><Text color="gray">  key loaded</Text></Box>
                <Text color={snap.ssh.keyLoaded ? 'green' : 'red'}>
                  {snap.ssh.keyLoaded ? 'yes' : snap.ssh.keyLoaded === false ? 'NO — git push will fail' : '—'}
                </Text>
              </Box>
              {snap.ssh.keyFingerprint && (
                <Box>
                  <Box width={18}><Text color="gray">  fingerprint</Text></Box>
                  <Text>{truncate(snap.ssh.keyFingerprint, 28)}</Text>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>TLS certificates ({snap.certs.length})</Text>
        {snap.certs.length === 0 && <Text color="gray">  no domains to check</Text>}
        {snap.certs.slice(0, 10).map(c => (
          <Box key={c.domain}>
            <Box width={32}><Text>{truncate(c.domain, 30)}</Text></Box>
            <Box width={16}>
              <Text color={certColor(c)}>
                {c.daysUntil == null ? 'no cert found' : `${c.daysUntil}d`}
              </Text>
            </Box>
            <Text color="gray">{c.expiresAt ? formatRelative(c.expiresAt) : ''}</Text>
          </Box>
        ))}
        {snap.certs.length > 10 && <Text color="gray">  +{snap.certs.length - 10} more…</Text>}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Secret rotation age ({snap.secretAges.length})</Text>
        {snap.secretAges.length === 0 && <Text color="gray">  no managed secrets</Text>}
        {snap.secretAges.slice(0, 10).map(s => (
          <Box key={s.app}>
            <Box width={22}><Text>{truncate(s.app, 20)}</Text></Box>
            <Box width={16}>
              <Text color={ageColor(s.ageDays)}>
                {s.ageDays != null ? `${s.ageDays}d old` : (s.error ?? '—')}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
