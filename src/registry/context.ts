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
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      return new Promise<boolean>(resolve => {
        // stdin EOF / SIGINT closes the interface — treat that as a "no".
        rl.on('close', () => resolve(false));
        rl.question(`${prompt} [y/N] `, answer => {
          // resolve before close: the first resolve wins, so the close
          // handler firing afterwards is a harmless no-op.
          resolve(/^y(es)?$/i.test(answer.trim()));
          rl.close();
        });
      });
    },
  };
}

/** mcp context: confirm is pre-resolved from the tool's `confirm` argument.
 *  per-event logs are silently dropped — the command result's `summary` is
 *  the sole output channel on the mcp surface. */
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
