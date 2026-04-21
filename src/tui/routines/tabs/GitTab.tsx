import React from 'react';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { AppEntry } from '@/core/registry.js';
import { formatRelative, truncate } from '@/tui/routines/format.js';
import { useGitFleet, type FleetPr, type FleetBranchState } from '@/tui/routines/hooks/use-git-fleet.js';

export interface GitTabProps {
  apps: AppEntry[];
}

function prAgeColor(updatedAt: string): string {
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  if (ageDays >= 14) return 'red';
  if (ageDays >= 7) return 'yellow';
  return 'gray';
}

function reviewBadge(decision: string | null): React.JSX.Element {
  if (decision === 'APPROVED') return <Text color="green">approved</Text>;
  if (decision === 'CHANGES_REQUESTED') return <Text color="yellow">changes</Text>;
  if (decision === 'REVIEW_REQUIRED') return <Text color="cyan">review</Text>;
  return <Text color="gray">—</Text>;
}

function PrRow({ pr }: { pr: FleetPr }): React.JSX.Element {
  return (
    <Box>
      <Box width={20}><Text>{truncate(pr.repo, 18)}</Text></Box>
      <Box width={8}>
        <Text color={pr.isDraft ? 'gray' : 'cyan'}>
          #{pr.number}{pr.isDraft ? ' d' : ''}
        </Text>
      </Box>
      <Box flexGrow={1}><Text>{truncate(pr.title, 55)}</Text></Box>
      <Box width={14}><Text color="gray">{pr.author}</Text></Box>
      <Box width={12}>{reviewBadge(pr.reviewDecision)}</Box>
      <Box width={14}><Text color={prAgeColor(pr.updatedAt)}>{formatRelative(pr.updatedAt)}</Text></Box>
    </Box>
  );
}

function BranchRow({ bs }: { bs: FleetBranchState }): React.JSX.Element {
  const diverged = bs.ahead > 0 || bs.behind > 0;
  return (
    <Box>
      <Box width={20}><Text>{truncate(bs.repo, 18)}</Text></Box>
      <Box width={18}><Text>{bs.branch}</Text></Box>
      <Box width={10}>
        <Text color={diverged ? 'yellow' : 'gray'}>↑{bs.ahead} ↓{bs.behind}</Text>
      </Box>
      <Box width={16}>
        <Text color={bs.clean ? 'green' : 'yellow'}>{bs.clean ? 'clean' : `${bs.dirtyCount} dirty`}</Text>
      </Box>
      <Box width={14}>
        <Text color={bs.releasePending > 0 ? 'magenta' : 'gray'}>{bs.releasePending} to release</Text>
      </Box>
    </Box>
  );
}

export function GitTab({ apps }: GitTabProps): React.JSX.Element {
  const snap = useGitFleet(apps);

  const prsToReview = snap.prs.filter(p => !p.isDraft && p.reviewDecision === 'REVIEW_REQUIRED');
  const prsApproved = snap.prs.filter(p => p.reviewDecision === 'APPROVED');
  const prsChanges = snap.prs.filter(p => p.reviewDecision === 'CHANGES_REQUESTED');
  const prsDraft = snap.prs.filter(p => p.isDraft);
  const stalePrs = snap.prs.filter(p => (Date.now() - new Date(p.updatedAt).getTime()) / 86_400_000 >= 7);
  const releaseReady = snap.branchStates.filter(b => b.releasePending > 0);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text bold>Git across the fleet</Text>
        <Text color="gray">{apps.length} repos</Text>
        <Text color="cyan">{snap.prs.length} open PRs</Text>
        <Text color="yellow">{stalePrs.length} stale</Text>
        <Text color="magenta">{releaseReady.length} ready to release</Text>
        {snap.loading && <Text color="cyan"><Spinner type="dots" /> refreshing</Text>}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Review queue ({prsToReview.length})</Text>
        {prsToReview.length === 0 && <Text color="gray">  nothing awaiting review</Text>}
        {prsToReview.slice(0, 6).map(pr => <PrRow key={`${pr.repo}-${pr.number}`} pr={pr} />)}

        {prsApproved.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="green">Approved ({prsApproved.length})</Text>
            {prsApproved.slice(0, 4).map(pr => <PrRow key={`${pr.repo}-${pr.number}`} pr={pr} />)}
          </Box>
        )}

        {prsChanges.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="yellow">Changes requested ({prsChanges.length})</Text>
            {prsChanges.slice(0, 4).map(pr => <PrRow key={`${pr.repo}-${pr.number}`} pr={pr} />)}
          </Box>
        )}

        {prsDraft.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="gray">Drafts ({prsDraft.length})</Text>
            {prsDraft.slice(0, 4).map(pr => <PrRow key={`${pr.repo}-${pr.number}`} pr={pr} />)}
          </Box>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Branch state</Text>
        {snap.branchStates.length === 0 && <Text color="gray">  no git repos detected</Text>}
        {snap.branchStates.map(bs => <BranchRow key={bs.repo} bs={bs} />)}
      </Box>

      {releaseReady.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
          <Text bold color="magenta">Release planner</Text>
          {releaseReady.map(bs => (
            <Box key={bs.repo}>
              <Box width={20}><Text>{truncate(bs.repo, 18)}</Text></Box>
              <Text color="magenta">{bs.releasePending} commits on develop unshipped to main</Text>
            </Box>
          ))}
        </Box>
      )}

      {snap.errors.length > 0 && (
        <Box flexDirection="column">
          <Text color="red">errors</Text>
          {snap.errors.map(e => <Text key={e.repo} color="red">  · {e.repo}: {e.message}</Text>)}
        </Box>
      )}
    </Box>
  );
}
