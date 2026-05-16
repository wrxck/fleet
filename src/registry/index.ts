import { register, _resetRegistry } from './registry';
import type { CommandDef } from './types';

/** every command definition. commands are added here as they are migrated
 *  onto the registry — empty until the first command migration task. */
const ALL: CommandDef[] = [];

let loaded = false;

/** registers every CommandDef. idempotent — safe to call from each surface. */
export function loadRegistry(): void {
  if (loaded) return;
  _resetRegistry();
  for (const def of ALL) {
    register(def);
  }
  loaded = true;
}

/** test-only: resets the loaded flag and clears the registry, so a test can
 *  re-run loadRegistry from a clean state. */
export function _resetLoader(): void {
  loaded = false;
  _resetRegistry();
}
