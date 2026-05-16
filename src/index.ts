#!/usr/bin/env node

import { run } from './cli';
import { error } from './ui/output';
import { FleetError } from './core/errors';

const isMcp = process.argv.includes('mcp');
const isInstallMcp = process.argv.includes('install-mcp');

run(process.argv).catch((err: unknown) => {
  if (err instanceof FleetError) {
    error(err.message);
    process.exit(err.exitCode);
  }
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
