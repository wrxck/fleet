import {
  GitStatus, ensureGitignore, gitInit, gitAdd, gitCommit,
  gitCheckout, gitPush, gitPushAll, gitAddRemote, gitSetRemoteUrl,
  branchExists, hasCommits,
} from './git.js';
import * as github from './github.js';
import { load, findApp, save } from './registry.js';

export type OnboardScenario = 'fresh' | 'migrate' | 'no-remote' | 'resume';

export interface OnboardResult {
  scenario: OnboardScenario;
  steps: string[];
  repoUrl: string;
  branches: string[];
}

export function detectScenario(status: GitStatus): OnboardScenario {
  if (!status.initialised) return 'fresh';
  if (status.remoteUrl && status.remoteUrl.includes('heskethwebdesign/')) return 'resume';
  if (status.remoteUrl && status.remoteUrl.includes('wrxck/')) return 'migrate';
  if (!status.remoteUrl) return 'no-remote';
  return 'fresh';
}

export function describeOnboardPlan(scenario: OnboardScenario, repoName: string, _status: GitStatus): string[] {
  const repoUrl = `git@github.com:heskethwebdesign/${repoName}.git`;
  const steps: string[] = [];

  switch (scenario) {
    case 'fresh':
      steps.push('generate .gitignore');
      steps.push('git init -b main');
      steps.push('git add . && git commit -m "initial commit"');
      steps.push(`create private repo heskethwebdesign/${repoName}`);
      steps.push(`add remote origin ${repoUrl}`);
      steps.push('push main');
      steps.push('create and push develop branch');
      steps.push('protect main and develop branches');
      steps.push('update fleet registry');
      break;
    case 'migrate':
      steps.push('ensure .gitignore exists');
      steps.push(`create private repo heskethwebdesign/${repoName}`);
      steps.push(`git remote set-url origin ${repoUrl}`);
      steps.push('git push --all origin');
      steps.push('ensure develop branch exists');
      steps.push('protect main and develop branches');
      steps.push('update fleet registry');
      break;
    case 'no-remote':
      steps.push('ensure .gitignore exists');
      steps.push('commit any outstanding changes');
      steps.push(`create private repo heskethwebdesign/${repoName}`);
      steps.push(`add remote origin ${repoUrl}`);
      steps.push('git push --all origin');
      steps.push('ensure develop branch exists');
      steps.push('protect main and develop branches');
      steps.push('update fleet registry');
      break;
    case 'resume':
      steps.push('ensure repo exists');
      steps.push('commit any outstanding changes');
      steps.push('push all branches');
      steps.push('ensure develop branch exists');
      steps.push('protect main and develop branches');
      steps.push('update fleet registry');
      break;
  }

  return steps;
}

function ensureDevelop(cwd: string, steps: string[]): void {
  if (!branchExists(cwd, 'develop')) {
    gitCheckout(cwd, 'develop', true);
    gitPush(cwd, 'develop', true);
    steps.push('created and pushed develop branch');
  } else {
    steps.push('develop branch already exists');
  }
}

export function executeOnboard(
  scenario: OnboardScenario,
  cwd: string,
  repoName: string,
  appName: string,
  status: GitStatus,
): OnboardResult {
  const repoUrl = github.getRepoUrl(repoName);
  const steps: string[] = [];

  steps.push(ensureGitignore(cwd));

  switch (scenario) {
    case 'fresh': {
      gitInit(cwd);
      steps.push('initialised git repo (main branch)');

      gitAdd(cwd);
      gitCommit(cwd, 'Initial commit');
      steps.push('created initial commit');

      github.createRepo(repoName);
      steps.push(`created private repo heskethwebdesign/${repoName}`);

      gitAddRemote(cwd, 'origin', repoUrl);
      gitPush(cwd, 'main', true);
      steps.push('pushed main to origin');

      gitCheckout(cwd, 'develop', true);
      gitPush(cwd, 'develop', true);
      steps.push('created and pushed develop branch');
      break;
    }

    case 'migrate': {
      github.createRepo(repoName);
      steps.push(`created private repo heskethwebdesign/${repoName}`);

      gitSetRemoteUrl(cwd, repoUrl);
      steps.push(`updated remote to ${repoUrl}`);

      gitPushAll(cwd);
      steps.push('pushed all branches to new remote');

      ensureDevelop(cwd, steps);
      break;
    }

    case 'no-remote': {
      if (!status.clean) {
        gitAdd(cwd);
        gitCommit(cwd, 'Pre-onboard commit');
        steps.push('committed outstanding changes');
      }

      if (!hasCommits(cwd)) {
        gitAdd(cwd);
        gitCommit(cwd, 'Initial commit');
        steps.push('created initial commit');
      }

      github.createRepo(repoName);
      steps.push(`created private repo heskethwebdesign/${repoName}`);

      gitAddRemote(cwd, 'origin', repoUrl);
      gitPushAll(cwd);
      steps.push('added remote and pushed all branches');

      ensureDevelop(cwd, steps);
      break;
    }

    case 'resume': {
      github.createRepo(repoName);
      steps.push('ensured repo exists');

      if (hasCommits(cwd)) {
        gitPushAll(cwd);
        steps.push('pushed existing commits');
      }

      ensureDevelop(cwd, steps);
      break;
    }
  }

  const mainProtected = github.protectBranch(repoName, 'main');
  const devProtected = github.protectBranch(repoName, 'develop');
  if (mainProtected && devProtected) {
    steps.push('protected main and develop branches');
  } else {
    steps.push('branch protection skipped (requires github pro for private repos)');
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (app) {
    app.gitRepo = `heskethwebdesign/${repoName}`;
    app.gitRemoteUrl = repoUrl;
    app.gitOnboardedAt = new Date().toISOString();
    save(reg);
    steps.push('updated fleet registry');
  }

  return { scenario, steps, repoUrl, branches: ['main', 'develop'] };
}
