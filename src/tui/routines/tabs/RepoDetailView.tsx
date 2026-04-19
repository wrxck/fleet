import React from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { AppEntry } from '@/core/registry.js';
import { formatRelative, truncate } from '@/tui/routines/format.js';
import { useRepoDetail } from '@/tui/routines/hooks/use-repo-detail.js';

export interface RepoDetailViewProps {
  app: AppEntry;
}

function StatValue({ label, value, color }: { label: string; value: React.ReactNode; color?: string }): React.JSX.Element {
  return (
    <Box>
      <Box width={14}><Text color="gray">{label}</Text></Box>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

export function RepoDetailView({ app }: RepoDetailViewProps): React.JSX.Element {
  const snap = useRepoDetail(app);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold color="cyan">{app.name}</Text>
        <Text color="gray">{app.type}</Text>
        {app.domains.length > 0 && <Text color="yellow">{app.domains.join(', ')}</Text>}
        {snap.loading ? (
          <Text color="cyan"><Spinner type="dots" /> refreshing</Text>
        ) : (
          <Text color="gray">updated {formatRelative(new Date(snap.refreshedAt).toISOString())}</Text>
        )}
      </Box>

      {snap.error && <Text color="red">✖ {snap.error}</Text>}

      <Box flexDirection="row" gap={4}>
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={48}>
          <Text bold>Git</Text>
          {snap.git === null || !snap.git.initialised ? (
            <Text color="gray">  not a git repo</Text>
          ) : (
            <>
              <StatValue label="branch" value={snap.git.branch || '—'} />
              <StatValue
                label="ahead/behind"
                value={`${snap.git.ahead} / ${snap.git.behind}`}
                color={snap.git.ahead > 0 || snap.git.behind > 0 ? 'yellow' : 'green'}
              />
              <StatValue
                label="working tree"
                value={snap.git.clean ? 'clean' : `${snap.git.modified + snap.git.staged + snap.git.untracked} dirty`}
                color={snap.git.clean ? 'green' : 'yellow'}
              />
              <StatValue label="remote" value={truncate(snap.git.remoteUrl || '—', 32)} />
              {snap.lastCommit && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold>Last commit</Text>
                  <Box>
                    <Text color="gray">  {snap.lastCommit.hash} </Text>
                    <Text>{truncate(snap.lastCommit.subject, 28)}</Text>
                  </Box>
                  <Box>
                    <Text color="gray">  {snap.lastCommit.author} · {formatRelative(snap.lastCommit.date)}</Text>
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={48}>
          <Text bold>Service</Text>
          {snap.service === null ? (
            <Text color="gray">  no systemd unit</Text>
          ) : (
            <>
              <StatValue label="unit" value={snap.service.name} />
              <StatValue
                label="active"
                value={snap.service.active ? 'active' : snap.service.state}
                color={snap.service.active ? 'green' : 'red'}
              />
              <StatValue
                label="enabled"
                value={snap.service.enabled ? 'yes' : 'no'}
                color={snap.service.enabled ? 'green' : 'yellow'}
              />
            </>
          )}
          <Box marginTop={1}>
            <Text bold>Containers</Text>
          </Box>
          {snap.runningContainers === null ? (
            <Text color="gray">  docker unavailable</Text>
          ) : snap.totalContainers === 0 ? (
            <Text color="yellow">  no containers for project</Text>
          ) : (
            <StatValue
              label="state"
              value={`${snap.runningContainers}/${snap.totalContainers} running`}
              color={snap.runningContainers === snap.totalContainers ? 'green' : snap.runningContainers > 0 ? 'yellow' : 'red'}
            />
          )}
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Open PRs {snap.openPrs ? `(${snap.openPrs.length})` : ''}</Text>
        {snap.openPrs === null ? (
          <Text color="gray">  gh unavailable or not a repo</Text>
        ) : snap.openPrs.length === 0 ? (
          <Text color="green">  no open PRs</Text>
        ) : (
          snap.openPrs.slice(0, 8).map(pr => (
            <Box key={pr.number}>
              <Box width={6}><Text color="cyan">#{pr.number}</Text></Box>
              {pr.isDraft && <Box width={8}><Text color="gray">draft</Text></Box>}
              <Box flexGrow={1}>
                <Text>{truncate(pr.title, 60)}</Text>
              </Box>
              <Box width={12}><Text color="gray">{pr.author}</Text></Box>
              <Text color="gray">{formatRelative(pr.updatedAt)}</Text>
            </Box>
          ))
        )}
      </Box>

      <Text color="gray">
        actions: r restart · s shell · l logs · a run nightly-audit · Esc back
      </Text>
    </Box>
  );
}
