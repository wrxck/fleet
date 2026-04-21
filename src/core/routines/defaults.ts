import type { Routine } from './schema.js';

export function builtInDefaultRoutines(): Routine[] {
  return [
    {
      id: 'nightly-audit',
      name: 'Nightly fleet audit',
      description: 'Runs `/auto-audit:tick` against each registered repo, capturing findings and opening PRs for high-severity fixes.',
      schedule: { kind: 'calendar', onCalendar: '*-*-* 02:00:00', randomizedDelaySec: 600, persistent: true },
      enabled: false,
      targets: [],
      perTarget: true,
      task: {
        kind: 'claude-cli',
        prompt: 'Run /auto-audit:tick against this repo. Report any HIGH-severity findings as bullet points; be terse.',
        outputFormat: 'json',
        tokenCap: 150_000,
        wallClockMs: 20 * 60 * 1000,
        maxUsd: 2,
      },
      notify: [{ kind: 'stdout', on: 'failure', config: {} }],
      tags: ['security', 'audit'],
    },
    {
      id: 'weekly-dep-drift',
      name: 'Weekly dep drift',
      description: 'Detects outdated dependencies and packages >1 major behind. Produces a consolidated markdown report.',
      schedule: { kind: 'calendar', onCalendar: 'Mon *-*-* 06:00:00', randomizedDelaySec: 300, persistent: true },
      enabled: false,
      targets: [],
      perTarget: true,
      task: {
        kind: 'shell',
        argv: ['npm', 'outdated', '--json'],
        wallClockMs: 5 * 60 * 1000,
      },
      notify: [{ kind: 'stdout', on: 'always', config: {} }],
      tags: ['deps'],
    },
    {
      id: 'stale-pr-nag',
      name: 'Stale PR nag',
      description: 'Lists open PRs older than 7 days across the fleet.',
      schedule: { kind: 'calendar', onCalendar: 'Fri *-*-* 16:00:00', randomizedDelaySec: 0, persistent: true },
      enabled: false,
      targets: [],
      perTarget: true,
      task: {
        kind: 'shell',
        argv: ['gh', 'pr', 'list', '--state', 'open', '--json', 'number,title,updatedAt,author,url', '--limit', '50'],
        wallClockMs: 60_000,
      },
      notify: [{ kind: 'stdout', on: 'always', config: {} }],
      tags: ['git', 'nag'],
    },
    {
      id: 'deploy-readiness',
      name: 'Deploy readiness',
      description: 'Aggregates fleet signals into a ship/block verdict. Manual trigger only.',
      schedule: { kind: 'manual' },
      enabled: true,
      targets: [],
      perTarget: false,
      task: {
        kind: 'mcp-call',
        tool: 'fleet_status',
        args: { summary: true },
        wallClockMs: 60_000,
      },
      notify: [],
      tags: ['deploy', 'release'],
    },
  ];
}
