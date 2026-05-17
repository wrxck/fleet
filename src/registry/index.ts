import { register, _resetRegistry } from './registry';
import { listCommand } from '../commands/list';
import { statusCommand } from '../commands/status';
import { startCommand } from '../commands/start';
import { stopCommand } from '../commands/stop';
import { restartCommand } from '../commands/restart';

/** every command definition. commands are added here as they are migrated
 *  onto the registry. */
const ALL = [statusCommand, listCommand, startCommand, stopCommand, restartCommand];

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
