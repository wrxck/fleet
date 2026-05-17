import { resolveAscCredentials, hasAscCredentials } from '../core/testflight/credentials';
import {
  ghVersion, resolveRepo, repoSecrets, dispatchWorkflow, latestRun, watchRun,
} from '../core/testflight/workflow';
import { listBuilds, expireBuild, setWhatsNew, verifyApp } from '../core/testflight/asc';
import { resolveTestflightTarget, appSecretsEnv } from '../core/testflight/resolve';
import { heading, success, error, info, warn, table } from '../ui/output';

// the build workflow this command dispatches by default — a macos-runner
// workflow committed to the app's repo at .github/workflows/.
const DEFAULT_WORKFLOW = 'ios-testflight.yml';

// the actions secrets the build workflow needs to sign and upload an .ipa.
const REQUIRED_REPO_SECRETS = [
  'ASC_API_KEY_ID', 'ASC_API_KEY_ISSUER_ID', 'ASC_API_KEY_B64', 'APPLE_TEAM_ID',
];

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// `fleet testflight` — publish a mobile app to TestFlight by dispatching its
// repo's macOS build workflow, and manage its builds through the App Store
// Connect API. an iOS .ipa can only be built on macOS, so publish runs the
// build on a github-hosted runner rather than locally.
export async function testflightCommand(args: string[]): Promise<void> {
  switch (args[0]) {
    case 'doctor': return tfDoctor(args.slice(1));
    case 'publish': return tfPublish(args.slice(1));
    case 'builds': return tfBuilds(args.slice(1));
    case 'update': return tfUpdate(args.slice(1));
    case 'delete': return tfDelete(args.slice(1));
    default:
      error('Usage: fleet testflight <doctor|publish|builds|update|delete>');
      process.exit(1);
  }
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function tfDoctor(args: string[]): Promise<void> {
  heading('TestFlight — readiness');

  const gh = ghVersion();
  if (gh) success(`GitHub CLI available: ${gh}`);
  else error('GitHub CLI (gh) not found — required to dispatch the build workflow');

  const appName = args.find(a => !a.startsWith('-'));
  if (!appName) {
    info('Pass an app name to check its repo + credentials: fleet testflight doctor <app>');
    return;
  }

  const { app, projectPath } = resolveTestflightTarget(appName);

  const repo = resolveRepo(projectPath);
  if (repo) {
    success(`GitHub repo: ${repo}`);
    const secrets = repoSecrets(repo);
    if (secrets) {
      const missing = REQUIRED_REPO_SECRETS.filter(s => !secrets.includes(s));
      if (missing.length === 0) success('Repo Actions secrets present — the build workflow can sign and upload');
      else warn(`Repo Actions secrets missing: ${missing.join(', ')} — set them with "gh secret set"`);
    } else {
      warn('Could not list repo Actions secrets — check "gh auth status"');
    }
  } else {
    warn(`No GitHub repo resolved for ${app} — publish needs a gh checkout at ${projectPath}`);
  }

  const env = appSecretsEnv(app);
  if (!hasAscCredentials(env)) {
    error(`App Store Connect credentials missing for ${app}`);
    info('Required vault secrets: ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_B64');
    process.exit(1);
  }
  success('App Store Connect credentials present (builds/update/delete)');

  const ascAppId = env.ASC_APP_ID;
  if (!ascAppId) {
    warn('ASC_APP_ID not set — builds/update/delete need it');
    return;
  }
  try {
    const name = await verifyApp(resolveAscCredentials(env), ascAppId);
    success(`App Store Connect reachable — app: ${name}`);
  } catch (err) {
    error(`App Store Connect check failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function tfPublish(args: string[]): Promise<void> {
  const appName = args.find(a => !a.startsWith('-'));
  if (!appName) {
    error('Usage: fleet testflight publish <app> [--workflow <file>] [--ref <branch>] [--watch]');
    process.exit(1);
  }
  const workflow = extractFlag(args, '--workflow') ?? DEFAULT_WORKFLOW;
  const ref = extractFlag(args, '--ref');
  const watch = args.includes('--watch');

  const { app, projectPath } = resolveTestflightTarget(appName);

  heading(`TestFlight publish: ${app}`);

  if (!ghVersion()) {
    error('GitHub CLI (gh) not found — required to dispatch the build workflow');
    process.exit(1);
  }
  const repo = resolveRepo(projectPath);
  if (!repo) {
    error(`Could not resolve a GitHub repo for ${app} — is ${projectPath} a gh checkout?`);
    process.exit(1);
  }

  // remember the newest run so the one this dispatch queues can be told
  // apart from it — `gh workflow run` returns no run id of its own.
  const before = latestRun(repo, workflow)?.databaseId ?? 0;

  info(`Dispatching ${workflow} on ${repo}${ref ? ` (${ref})` : ''}...`);
  const dispatch = dispatchWorkflow(repo, workflow, ref);
  if (!dispatch.ok) {
    error(`Workflow dispatch failed: ${dispatch.message}`);
    process.exit(1);
  }
  success('Workflow dispatched — the iOS build runs on a macOS runner (~15-30 min)');

  // the queued run is not addressable straight away; poll briefly for it.
  let run = latestRun(repo, workflow);
  for (let i = 0; i < 10 && (!run || run.databaseId === before); i++) {
    await sleep(3000);
    run = latestRun(repo, workflow);
  }
  if (!run || run.databaseId === before) {
    info(`Track it at https://github.com/${repo}/actions/workflows/${workflow}`);
    return;
  }
  info(`Run: ${run.url}`);

  if (watch) {
    const code = watchRun(repo, run.databaseId);
    if (code !== 0) {
      error('The build workflow failed — see the run log above');
      process.exit(1);
    }
    success(`${app} built and uploaded to TestFlight`);
  }
}

async function tfBuilds(args: string[]): Promise<void> {
  const appName = args.find(a => !a.startsWith('-'));
  const json = args.includes('--json');
  if (!appName) {
    error('Usage: fleet testflight builds <app> [--app-id <id>] [--json]');
    process.exit(1);
  }

  const { app } = resolveTestflightTarget(appName);
  const env = appSecretsEnv(app);
  const ascAppId = extractFlag(args, '--app-id') ?? env.ASC_APP_ID;
  if (!ascAppId) {
    error('App Store Connect app id required — set ASC_APP_ID or pass --app-id');
    process.exit(1);
  }

  const builds = await listBuilds(resolveAscCredentials(env), ascAppId);
  if (json) {
    process.stdout.write(JSON.stringify(builds, null, 2) + '\n');
    return;
  }

  heading(`TestFlight builds: ${app}`);
  if (builds.length === 0) {
    info('No builds found.');
    return;
  }
  table(
    ['BUILD', 'VERSION', 'STATE', 'EXPIRED', 'UPLOADED'],
    builds.map(b => [
      b.version,
      b.shortVersion,
      b.processingState,
      b.expired ? 'yes' : 'no',
      b.uploadedDate.slice(0, 10),
    ]),
  );
  process.stdout.write('\n');
}

async function tfUpdate(args: string[]): Promise<void> {
  const appName = args.find(a => !a.startsWith('-'));
  const buildId = extractFlag(args, '--build');
  const whatsNew = extractFlag(args, '--whats-new');
  if (!appName || !buildId || !whatsNew) {
    error('Usage: fleet testflight update <app> --build <build-id> --whats-new "..."');
    process.exit(1);
  }

  const { app } = resolveTestflightTarget(appName);
  await setWhatsNew(resolveAscCredentials(appSecretsEnv(app)), buildId, whatsNew);
  success(`Updated the "What to Test" notes for build ${buildId}`);
}

async function tfDelete(args: string[]): Promise<void> {
  const appName = args.find(a => !a.startsWith('-'));
  const buildId = extractFlag(args, '--build');
  if (!appName || !buildId) {
    error('Usage: fleet testflight delete <app> --build <build-id>');
    process.exit(1);
  }

  const { app } = resolveTestflightTarget(appName);
  await expireBuild(resolveAscCredentials(appSecretsEnv(app)), buildId);
  success(`Expired build ${buildId} — it is no longer installable from TestFlight`);
}
