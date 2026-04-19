import type { NotifierAdapter } from '../types.js';

export function createStdoutNotifier(): NotifierAdapter {
  return {
    id: 'stdout',
    async notify(subject, body): Promise<void> {
      process.stdout.write(`\n${subject}\n${body}\n`);
    },
  };
}
