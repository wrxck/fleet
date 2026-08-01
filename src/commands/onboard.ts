import { checkApp, type OnboardingCheck } from '../core/onboarding';
import { c, heading, error } from '../ui/output';

const STATUS_LABEL: Record<OnboardingCheck['status'], string> = {
  ok: `${c.green}ok${c.reset}     `,
  missing: `${c.red}missing${c.reset}`,
  warn: `${c.yellow}warn${c.reset}   `,
  skip: `${c.dim}skip${c.reset}   `,
};

/**
 * `fleet onboard <app>` — pretty-print the onboarding checklist with per-fix
 * runner labels (mcp / cli / operator-root) so a human or an agent knows what
 * to run and who can run it. Exits non-zero when a blocking check is missing,
 * so scripts can gate on it.
 */
export async function onboardCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const target = args.find(a => !a.startsWith('-'));

  if (!target) {
    error('Usage: fleet onboard <app> [--json]');
    process.exit(1);
  }

  const report = await checkApp(target);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    heading(`Onboarding: ${report.app}`);
    for (const check of report.checks) {
      const blocking = check.blocking && check.status === 'missing' ? ` ${c.red}[blocking]${c.reset}` : '';
      process.stdout.write(`  ${STATUS_LABEL[check.status]} ${c.bold}${check.title}${c.reset}${blocking}\n`);
      process.stdout.write(`          ${c.dim}${check.detail}${c.reset}\n`);
      if (check.fix && check.status !== 'ok' && check.status !== 'skip') {
        process.stdout.write(`          fix (${runnerLabel(check.fix.runner)}): ${check.fix.command}\n`);
      }
    }
    process.stdout.write('\n');
    process.stdout.write(report.ok
      ? `${c.green}All blocking checks pass.${c.reset}\n`
      : `${c.red}Blocking checks missing — deploy will fail until they are fixed.${c.reset}\n`);
  }

  if (!report.ok) process.exit(1);
}

function runnerLabel(runner: 'mcp' | 'cli' | 'operator-root'): string {
  switch (runner) {
    case 'mcp': return 'mcp-callable';
    case 'cli': return 'cli';
    case 'operator-root': return 'operator, root shell';
  }
}
