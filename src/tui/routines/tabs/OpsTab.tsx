import React from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { AppEntry } from '@/core/registry.js';
import { formatRelative, truncate } from '@/tui/routines/format.js';
import { useOpsFleet, type OpsRepoState } from '@/tui/routines/hooks/use-ops-fleet.js';

export interface OpsTabProps {
  apps: AppEntry[];
}

function serviceColor(repo: OpsRepoState): string {
  if (!repo.service) return 'gray';
  if (!repo.service.active) return 'red';
  if (repo.totalContainers === 0) return 'yellow';
  return repo.runningContainers === repo.totalContainers ? 'green' : 'yellow';
}

function RepoOpsRow({ repo }: { repo: OpsRepoState }): React.JSX.Element {
  return (
    <Box>
      <Box width={22}><Text>{truncate(repo.name, 20)}</Text></Box>
      <Box width={14}>
        <Text color={serviceColor(repo)}>
          {repo.service ? (repo.service.active ? 'active' : repo.service.state) : '—'}
        </Text>
      </Box>
      <Box width={12}>
        <Text color={repo.service?.enabled ? 'green' : 'gray'}>
          {repo.service?.enabled ? 'enabled' : '—'}
        </Text>
      </Box>
      <Box width={14}>
        <Text>
          {repo.totalContainers > 0
            ? `${repo.runningContainers}/${repo.totalContainers}`
            : <Text color="gray">—</Text>}
        </Text>
      </Box>
    </Box>
  );
}

function diskColor(pct: number | null): string {
  if (pct == null) return 'gray';
  if (pct >= 90) return 'red';
  if (pct >= 75) return 'yellow';
  return 'green';
}

export function OpsTab({ apps }: OpsTabProps): React.JSX.Element {
  const snap = useOpsFleet(apps);

  const downServices = snap.repos.filter(r => r.service && !r.service.active).length;
  const stoppedContainers = snap.repos.filter(r => r.totalContainers > 0 && r.runningContainers < r.totalContainers).length;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold>Ops overview</Text>
        <Text color={downServices > 0 ? 'red' : 'green'}>{downServices} services down</Text>
        <Text color={stoppedContainers > 0 ? 'yellow' : 'green'}>{stoppedContainers} repos with stopped containers</Text>
        {snap.loading ? (
          <Text color="cyan"><Spinner type="dots" /> refreshing</Text>
        ) : (
          <Text color="gray">updated {formatRelative(new Date(snap.refreshedAt).toISOString())}</Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Infrastructure</Text>
        <Box>
          <Box width={18}><Text color="gray">  docker-databases</Text></Box>
          <Text color={snap.dockerDatabasesActive ? 'green' : 'red'}>
            {snap.dockerDatabasesActive ? 'active' : snap.dockerDatabasesActive === false ? 'down' : 'unknown'}
          </Text>
        </Box>
        <Box>
          <Box width={18}><Text color="gray">  nginx</Text></Box>
          <Text color={snap.nginxOk ? 'green' : snap.nginxOk === false ? 'red' : 'gray'}>
            {snap.nginxOk ? 'config valid' : snap.nginxOk === false ? 'config BROKEN' : '—'}
          </Text>
          {snap.nginxSites != null && <Text color="gray"> · {snap.nginxSites} sites</Text>}
        </Box>
        <Box>
          <Box width={18}><Text color="gray">  /home disk</Text></Box>
          <Text color={diskColor(snap.diskPercent)}>
            {snap.diskPercent != null ? `${snap.diskPercent}% used` : '—'}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box>
          <Box width={22}><Text bold>APP</Text></Box>
          <Box width={14}><Text bold>SERVICE</Text></Box>
          <Box width={12}><Text bold>AUTOSTART</Text></Box>
          <Box width={14}><Text bold>CONTAINERS</Text></Box>
        </Box>
        {snap.repos.length === 0 && <Text color="gray">  no apps</Text>}
        {snap.repos.map(r => <RepoOpsRow key={r.name} repo={r} />)}
      </Box>

      <Text color="gray">
        fleet-native actions live outside this tab: `fleet restart` / `fleet deploy` / `fleet nginx`
      </Text>
    </Box>
  );
}
