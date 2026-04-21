import { load, findApp } from '../core/registry.js';
import { refresh } from '../core/boot-refresh.js';
import { composeUp } from '../core/docker.js';

function log(msg: string): void {
  process.stdout.write(`[boot-start] ${msg}\n`);
}

function logErr(msg: string): void {
  process.stderr.write(`[boot-start] ${msg}\n`);
}

export async function bootStartCommand(args: string[]): Promise<void> {
  const appName = args[0];
  if (!appName) {
    logErr('Usage: fleet boot-start <app>');
    process.exit(1);
  }

  const reg = load();
  const app = findApp(reg, appName);
  if (!app) {
    logErr(`app not found: ${appName}`);
    process.exit(1);
  }

  // Refresh is best-effort. Any error — sync or async — is caught here and logged,
  // then compose up ALWAYS runs. This is the fail-safe contract for boot.
  try {
    const result = await refresh(app);
    switch (result.kind) {
      case 'refreshed':
        log(`refreshed ${app.name} head=${result.head} built=${result.built}`);
        break;
      case 'no-change':
        log(`no-change ${app.name} head=${result.head}`);
        break;
      case 'skipped':
        log(`skipped ${app.name} reason=${result.reason}`);
        break;
      case 'failed-safe':
        log(`failed-safe ${app.name} step=${result.step} detail=${result.detail}`);
        break;
    }
  } catch (err) {
    log(`failed-safe ${app.name} step=outer-catch detail=${err instanceof Error ? err.message : String(err)}`);
  }

  // compose up — the only step whose exit code matters
  const ok = composeUp(app.composePath, app.composeFile);
  if (!ok) {
    logErr(`compose up failed for ${app.name}`);
    process.exit(1);
  }
  log(`up ${app.name}`);
}
