import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAscCredentials, hasAscCredentials, easEnv } from '../core/testflight/credentials';
import { easVersion, easBuild, easSubmit } from '../core/testflight/eas';
import { listBuilds, expireBuild, setWhatsNew, verifyApp } from '../core/testflight/asc';
import { resolveTestflightTarget, appSecretsEnv } from '../core/testflight/resolve';
import { heading, success, error, info, warn, table } from '../ui/output';

// `fleet testflight` — publish a mobile app to TestFlight (eas build + eas
// submit) and manage its builds through the App Store Connect API.
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

  const eas = easVersion();
  if (eas) success(`eas-cli available: ${eas}`);
  else error('eas-cli not reachable via npx — check the Node toolchain');

  const appName = args.find(a => !a.startsWith('-'));
  if (!appName) {
    info('Pass an app name to check its credentials: fleet testflight doctor <app>');
    return;
  }

  const { app } = resolveTestflightTarget(appName);
  const env = appSecretsEnv(app);
  if (!hasAscCredentials(env)) {
    error(`App Store Connect credentials missing for ${app}`);
    info('Required secrets: ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_B64');
    process.exit(1);
  }
  success('App Store Connect credentials present');

  if (!env.EXPO_TOKEN) warn('EXPO_TOKEN not set — eas build/submit cannot run non-interactively');

  const ascAppId = env.ASC_APP_ID;
  if (!ascAppId) {
    warn('ASC_APP_ID not set — builds/update/delete need it (publish can create the app)');
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
    error('Usage: fleet testflight publish <app> [--profile <name>] [--no-build]');
    process.exit(1);
  }
  const profile = extractFlag(args, '--profile') ?? 'production';
  const skipBuild = args.includes('--no-build');

  const { app, projectPath } = resolveTestflightTarget(appName);
  const env = appSecretsEnv(app);
  const submitEnv = easEnv(env);
  if (!submitEnv.EXPO_TOKEN) {
    error(`EXPO_TOKEN not set for ${app} — eas needs it to run non-interactively`);
    process.exit(1);
  }

  heading(`TestFlight publish: ${app}`);

  // materialise the asc api key where eas.json's ascApiKeyPath expects it,
  // when the vault holds it base64-encoded. removed again once eas finishes
  // so the key is never left on disk.
  let tempKey: string | undefined;
  const keyPath = join(projectPath, 'secrets', 'asc-api-key.p8');
  if (env.ASC_API_KEY_B64 && !existsSync(keyPath)) {
    mkdirSync(join(projectPath, 'secrets'), { recursive: true });
    writeFileSync(
      keyPath,
      Buffer.from(env.ASC_API_KEY_B64, 'base64').toString('utf-8'),
      { mode: 0o600 },
    );
    tempKey = keyPath;
  }

  try {
    if (!skipBuild) {
      info(`Building iOS (${profile}) — an EAS cloud build can take 20+ minutes...`);
      const code = easBuild(projectPath, profile, submitEnv);
      if (code !== 0) {
        error(`eas build failed (exit ${code})`);
        process.exit(1);
      }
      success('Build complete');
    } else {
      info('Skipping build — submitting the most recent existing build');
    }

    info('Submitting to TestFlight...');
    const code = easSubmit(projectPath, profile, submitEnv);
    if (code !== 0) {
      error(`eas submit failed (exit ${code})`);
      process.exit(1);
    }
    success(`Submitted ${app} to TestFlight`);
  } finally {
    if (tempKey && existsSync(tempKey)) unlinkSync(tempKey);
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
