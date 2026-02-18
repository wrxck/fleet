#!/usr/bin/env node

import { run } from './cli.js';
import { error } from './ui/output.js';
import { FleetError } from './core/errors.js';

const isMcp = process.argv.includes('mcp');
const isInstallMcp = process.argv.includes('install-mcp');

if (!isMcp && !isInstallMcp && process.getuid && process.getuid() !== 0) {
  error('fleet must be run as root');
  process.exit(1);
}

run(process.argv).catch((err: unknown) => {
  if (err instanceof FleetError) {
    error(err.message);
    process.exit(err.exitCode);
  }
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
