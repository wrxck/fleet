#!/usr/bin/env node
import { main } from '../core/secrets-v2.js';

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[fleet-agent] fatal: ${message}\n`);
  process.exit(1);
});
