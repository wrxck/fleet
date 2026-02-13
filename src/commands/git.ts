import { load, findApp } from '../core/registry.js';
import { AppNotFoundError } from '../core/errors.js';
import {
  getGitStatus, getProjectRoot, gitAdd, gitCommit, gitCheckout, gitPush,
} from '../core/git.js';
import { detectScenario, describeOnboardPlan, executeOnboard } from '../core/git-onboard.js';
import * as github from '../core/github.js';
import { confirm } from '../ui/confirm.js';
import { c, heading, table, success, error, info, warn } from '../ui/output.js';

function requireApp(name: string) {
  const reg = load();
  const app = findApp(reg, name);
  if (!app) throw new AppNotFoundError(name);
  return { reg, app };
}

function root(composePath: string): string {
  return getProjectRoot(composePath);
}

export async function gitCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'status': return gitStatusCmd(rest);
    case 'onboard': return gitOnboardCmd(rest);
    case 'onboard-all': return gitOnboardAllCmd(rest);
    case 'branch': return gitBranchCmd(rest);
    case 'commit': return gitCommitCmd(rest);
    case 'push': return gitPushCmd(rest);
    case 'pr': return gitPrCmd(rest);
    case 'release': return gitReleaseCmd(rest);
    default:
      error('Usage: fleet git <status|onboard|onboard-all|branch|commit|push|pr|release>');
      process.exit(1);
  }
}

function gitStatusCmd(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));
  const reg = load();

  if (appName) {
    const app = findApp(reg, appName);
    if (!app) throw new AppNotFoundError(appName);
    const r = root(app.composePath);
    const status = getGitStatus(r);
    if (json) {
      process.stdout.write(JSON.stringify({ app: app.name, root: r, ...status }, null, 2) + '\n');
      return;
    }
    heading(`Git: ${app.name}`);
    info(`root: ${r}`);
    info(`initialised: ${status.initialised}`);
    if (status.initialised) {
      info(`branch: ${status.branch} | branches: ${status.branches.join(', ')}`);
      info(`remote: ${status.remoteUrl || 'none'}`);
      info(`clean: ${status.clean}`);
      if (!status.clean) info(`staged: ${status.staged}  modified: ${status.modified}  untracked: ${status.untracked}`);
      if (status.ahead || status.behind) info(`ahead: ${status.ahead}  behind: ${status.behind}`);
    }
    info(`onboarded: ${app.gitOnboardedAt || 'no'}`);
    return;
  }

  const results = reg.apps.map(app => ({
    name: app.name,
    status: getGitStatus(root(app.composePath)),
    onboarded: app.gitOnboardedAt,
  }));

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  heading(`Git Status (${results.length} apps)`);
  const rows = results.map(r => {
    const s = r.status;
    const state = !s.initialised
      ? `${c.red}no git${c.reset}`
      : s.clean ? `${c.green}clean${c.reset}` : `${c.yellow}dirty${c.reset}`;
    const ob = r.onboarded ? `${c.green}yes${c.reset}` : `${c.dim}no${c.reset}`;
    return [`${c.bold}${r.name}${c.reset}`, s.branch || '-', state, ob];
  });
  table(['APP', 'BRANCH', 'STATE', 'ONBOARDED'], rows);
  process.stdout.write('\n');
}

async function gitOnboardCmd(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('-y') || args.includes('--yes');
  const appName = args.find(a => !a.startsWith('-'));

  if (!appName) { error('Usage: fleet git onboard <app> [--dry-run] [-y]'); process.exit(1); }

  const { app } = requireApp(appName);
  const r = root(app.composePath);
  const status = getGitStatus(r);
  const scenario = detectScenario(status);

  if (dryRun) {
    heading(`Onboard plan: ${app.name} (${scenario})`);
    info(`root: ${r}`);
    describeOnboardPlan(scenario, app.name, status).forEach((s, i) => info(`${i + 1}. ${s}`));
    warn('dry run - no changes made');
    return;
  }

  if (!yes && !await confirm(`Onboard ${app.name} (${scenario})? This will create a GitHub repo and push code.`)) {
    info('cancelled');
    return;
  }

  const result = executeOnboard(scenario, r, app.name, app.name, status);
  heading(`Onboarded: ${app.name}`);
  result.steps.forEach(s => success(s));
  info(`repo: ${result.repoUrl}`);
}

async function gitOnboardAllCmd(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('-y') || args.includes('--yes');
  const reg = load();
  const todo = reg.apps.filter(a => !a.gitOnboardedAt);

  if (todo.length === 0) { info('all apps already onboarded'); return; }

  heading(`Onboard ${todo.length} apps`);

  for (const app of todo) {
    const r = root(app.composePath);
    const status = getGitStatus(r);
    const scenario = detectScenario(status);

    if (dryRun) {
      info(`\n${c.bold}${app.name}${c.reset} (${scenario})`);
      describeOnboardPlan(scenario, app.name, status).forEach((s, i) => info(`  ${i + 1}. ${s}`));
      continue;
    }

    if (!yes && !await confirm(`Onboard ${app.name} (${scenario})?`)) { warn(`skipped ${app.name}`); continue; }

    try {
      const result = executeOnboard(scenario, r, app.name, app.name, status);
      success(`${app.name}: onboarded (${result.scenario})`);
    } catch (err) {
      error(`${app.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (dryRun) warn('\ndry run - no changes made');
}

function gitBranchCmd(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const positional = args.filter(a => !a.startsWith('-'));
  const appName = positional[0];
  const branchName = positional[1];
  const fromIdx = args.indexOf('--from');
  const from = fromIdx >= 0 ? args[fromIdx + 1] : 'develop';

  if (!appName || !branchName) { error('Usage: fleet git branch <app> <name> [--from develop]'); process.exit(1); }

  const { app } = requireApp(appName);
  const r = root(app.composePath);

  if (dryRun) { info(`would checkout ${from}, create branch ${branchName}, and push`); return; }

  gitCheckout(r, from);
  gitCheckout(r, branchName, true);
  gitPush(r, branchName, true);
  success(`created and pushed branch ${branchName} from ${from}`);
}

function gitCommitCmd(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const appName = args.find(a => !a.startsWith('-') && a !== '-m');
  const msgIdx = args.indexOf('-m');
  const message = msgIdx >= 0 ? args[msgIdx + 1] : '';

  if (!appName || !message) { error('Usage: fleet git commit <app> -m "message"'); process.exit(1); }

  const { app } = requireApp(appName);
  const r = root(app.composePath);

  if (dryRun) { info(`would stage all and commit: "${message}"`); return; }

  gitAdd(r);
  gitCommit(r, message);
  success(`committed: ${message}`);
}

function gitPushCmd(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const appName = args.find(a => !a.startsWith('-'));

  if (!appName) { error('Usage: fleet git push <app>'); process.exit(1); }

  const { app } = requireApp(appName);
  const r = root(app.composePath);
  const status = getGitStatus(r);

  if (dryRun) { info(`would push branch ${status.branch}`); return; }

  gitPush(r, status.branch, true);
  success(`pushed ${status.branch}`);
}

function gitPrCmd(args: string[]): void {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'create': return gitPrCreateCmd(rest);
    case 'list': return gitPrListCmd(rest);
    default: error('Usage: fleet git pr <create|list>'); process.exit(1);
  }
}

function gitPrCreateCmd(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const appName = args.find(a => !a.startsWith('-'));
  const titleIdx = args.indexOf('--title');
  const title = titleIdx >= 0 ? args[titleIdx + 1] : '';
  const baseIdx = args.indexOf('--base');
  const base = baseIdx >= 0 ? args[baseIdx + 1] : 'develop';

  if (!appName || !title) { error('Usage: fleet git pr create <app> --title "..." [--base develop]'); process.exit(1); }

  const { app } = requireApp(appName);
  const r = root(app.composePath);
  const status = getGitStatus(r);

  if (dryRun) { info(`would create PR: "${title}" (${status.branch} -> ${base})`); return; }

  const pr = github.createPullRequest(app.name, { title, head: status.branch, base });
  success(`created PR #${pr.number}: ${pr.url}`);
}

function gitPrListCmd(args: string[]): void {
  const json = args.includes('--json');
  const appName = args.find(a => !a.startsWith('-'));

  if (!appName) { error('Usage: fleet git pr list <app> [--json]'); process.exit(1); }

  const { app } = requireApp(appName);
  const prs = github.listPullRequests(app.name);

  if (json) { process.stdout.write(JSON.stringify(prs, null, 2) + '\n'); return; }
  if (prs.length === 0) { info('no open pull requests'); return; }

  heading(`Pull Requests: ${app.name} (${prs.length} open)`);
  const rows = prs.map(pr => [
    `${c.bold}#${pr.number}${c.reset}`, pr.title, `${pr.head} -> ${pr.base}`, pr.url,
  ]);
  table(['PR', 'TITLE', 'BRANCHES', 'URL'], rows);
  process.stdout.write('\n');
}

function gitReleaseCmd(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const appName = args.find(a => !a.startsWith('-'));
  const titleIdx = args.indexOf('--title');
  const title = titleIdx >= 0 ? args[titleIdx + 1] : '';

  if (!appName) { error('Usage: fleet git release <app> [--title "..."]'); process.exit(1); }

  const { app } = requireApp(appName);
  const prTitle = title || `Release: ${app.name}`;

  if (dryRun) { info(`would create PR: "${prTitle}" (develop -> main)`); return; }

  const pr = github.createPullRequest(app.name, { title: prTitle, head: 'develop', base: 'main' });
  success(`created release PR #${pr.number}: ${pr.url}`);
}
