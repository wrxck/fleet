import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { load, findApp } from '../core/registry.js';
import { getGitStatus, getProjectRoot, gitAddTracked, gitCommit, gitCheckout, gitPush } from '../core/git.js';
import { detectScenario, describeOnboardPlan, executeOnboard } from '../core/git-onboard.js';
import * as github from '../core/github.js';
import { AppNotFoundError } from '../core/errors.js';

function requireApp(name: string) {
  const reg = load();
  const app = findApp(reg, name);
  if (!app) throw new AppNotFoundError(name);
  return app;
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function onboardHint(app: ReturnType<typeof requireApp>): string | null {
  if (app.gitOnboardedAt) return null;
  return `${app.name} is not git-onboarded yet. Run fleet_git_onboard first.`;
}

export function registerGitTools(server: McpServer): void {
  server.tool(
    'fleet_git_status',
    'Git state for one or all apps: branch, clean/dirty, onboard status',
    { app: z.string().optional().describe('App name (omit for all apps)') },
    async ({ app: appName }) => {
      const reg = load();
      if (appName) {
        const app = findApp(reg, appName);
        if (!app) throw new AppNotFoundError(appName);
        const root = getProjectRoot(app.composePath);
        const status = getGitStatus(root);
        return text(JSON.stringify({ app: app.name, root, onboarded: !!app.gitOnboardedAt, ...status }, null, 2));
      }
      const results = reg.apps.map(a => {
        const root = getProjectRoot(a.composePath);
        const status = getGitStatus(root);
        return { app: a.name, onboarded: !!a.gitOnboardedAt, branch: status.branch, clean: status.clean, initialised: status.initialised };
      });
      return text(JSON.stringify(results, null, 2));
    },
  );

  server.tool(
    'fleet_git_onboard',
    'Onboard an app to GitHub: create repo, push code, protect branches',
    {
      app: z.string().describe('App name'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
    },
    async ({ app: appName, dryRun }) => {
      const app = requireApp(appName);
      const root = getProjectRoot(app.composePath);
      const status = getGitStatus(root);
      const scenario = detectScenario(status);

      if (dryRun) {
        const plan = describeOnboardPlan(scenario, app.name, status);
        return text(`Scenario: ${scenario}\nRoot: ${root}\n\nPlan:\n${plan.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
      }

      const result = executeOnboard(scenario, root, app.name, app.name, status);
      return text(`Onboarded ${app.name} (${result.scenario})\n\nSteps:\n${result.steps.map(s => `- ${s}`).join('\n')}\n\nRepo: ${result.repoUrl}`);
    },
  );

  server.tool(
    'fleet_git_branch',
    'Create a feature branch from develop (or other base) and push it',
    {
      app: z.string().describe('App name'),
      branch: z.string().describe('New branch name'),
      from: z.string().optional().default('develop').describe('Base branch'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
    },
    async ({ app: appName, branch, from, dryRun }) => {
      const app = requireApp(appName);
      const hint = onboardHint(app);
      if (hint) return text(hint);
      const root = getProjectRoot(app.composePath);

      if (dryRun) return text(`Would checkout ${from}, create branch ${branch}, and push`);

      gitCheckout(root, from);
      gitCheckout(root, branch, true);
      gitPush(root, branch, true);
      return text(`Created and pushed branch ${branch} from ${from}`);
    },
  );

  server.tool(
    'fleet_git_commit',
    'Stage tracked file changes and commit',
    {
      app: z.string().describe('App name'),
      message: z.string().describe('Commit message'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
    },
    async ({ app: appName, message, dryRun }) => {
      const app = requireApp(appName);
      const hint = onboardHint(app);
      if (hint) return text(hint);
      const root = getProjectRoot(app.composePath);

      if (dryRun) return text(`Would stage tracked changes and commit: "${message}"`);

      gitAddTracked(root);
      gitCommit(root, message);
      return text(`Committed: ${message}`);
    },
  );

  server.tool(
    'fleet_git_push',
    'Push current branch to origin',
    {
      app: z.string().describe('App name'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
    },
    async ({ app: appName, dryRun }) => {
      const app = requireApp(appName);
      const hint = onboardHint(app);
      if (hint) return text(hint);
      const root = getProjectRoot(app.composePath);
      const status = getGitStatus(root);

      if (dryRun) return text(`Would push branch ${status.branch}`);

      gitPush(root, status.branch, true);
      return text(`Pushed ${status.branch}`);
    },
  );

  server.tool(
    'fleet_git_pr_create',
    'Create a pull request on GitHub',
    {
      app: z.string().describe('App name'),
      title: z.string().describe('PR title'),
      body: z.string().optional().describe('PR description'),
      base: z.string().optional().default('develop').describe('Base branch'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
    },
    async ({ app: appName, title, body, base, dryRun }) => {
      const app = requireApp(appName);
      const hint = onboardHint(app);
      if (hint) return text(hint);
      const root = getProjectRoot(app.composePath);
      const status = getGitStatus(root);

      if (dryRun) return text(`Would create PR: "${title}" (${status.branch} -> ${base})`);

      const pr = github.createPullRequest(app.name, { title, body, head: status.branch, base });
      return text(`Created PR #${pr.number}: ${pr.url}`);
    },
  );

  server.tool(
    'fleet_git_pr_list',
    'List pull requests for an app',
    {
      app: z.string().describe('App name'),
      state: z.enum(['open', 'closed', 'all']).optional().default('open').describe('PR state filter'),
    },
    async ({ app: appName, state }) => {
      const app = requireApp(appName);
      const hint = onboardHint(app);
      if (hint) return text(hint);
      const prs = github.listPullRequests(app.name, state);
      return text(JSON.stringify(prs, null, 2));
    },
  );

  server.tool(
    'fleet_git_release',
    'Create a release PR from develop to main',
    {
      app: z.string().describe('App name'),
      title: z.string().optional().describe('PR title (defaults to "Release: <app>")'),
      dryRun: z.boolean().optional().default(false).describe('Preview without making changes'),
    },
    async ({ app: appName, title, dryRun }) => {
      const app = requireApp(appName);
      const hint = onboardHint(app);
      if (hint) return text(hint);
      const prTitle = title || `Release: ${app.name}`;

      if (dryRun) return text(`Would create PR: "${prTitle}" (develop -> main)`);

      const pr = github.createPullRequest(app.name, { title: prTitle, head: 'develop', base: 'main' });
      return text(`Created release PR #${pr.number}: ${pr.url}`);
    },
  );
}
