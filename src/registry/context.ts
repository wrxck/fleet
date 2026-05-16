import { createInterface } from 'node:readline';

import type { CommandContext } from './types';

/** cli context: confirm prompts on stdin, log writes to stderr. */
export function makeCliContext(): CommandContext {
  return {
    env: process.env,
    log(event) {
      process.stderr.write(`[${event.level}] ${event.message}\n`);
    },
    confirm(prompt) {
      return new Promise<boolean>(resolve => {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        rl.question(`${prompt} [y/N] `, answer => {
          rl.close();
          resolve(/^y(es)?$/i.test(answer.trim()));
        });
      });
    },
  };
}

/** mcp context: confirm is pre-resolved from the tool's `confirm` argument. */
export function makeMcpContext(confirmGranted: boolean): CommandContext {
  return {
    env: process.env,
    log() {
      // mcp surfaces collect output via the result; per-event logs are dropped.
    },
    async confirm() {
      return confirmGranted;
    },
  };
}
