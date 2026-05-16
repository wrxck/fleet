import type { z } from 'zod';

import type { CommandContext, CommandDef, CommandResult } from './types';

const registry = new Map<string, CommandDef>();

export function register(def: CommandDef): void {
  if (registry.has(def.name)) {
    throw new Error(`duplicate command registration: ${def.name}`);
  }
  registry.set(def.name, def);
}

/**
 * defines a command with full argument-type inference: the `args` schema and
 * the `run` handler's first parameter are tied through the shape generic `S`.
 * returns the erased `CommandDef` the registry stores.
 */
export function defineCommand<S extends z.ZodRawShape, D>(def: {
  name: string;
  summary: string;
  args: z.ZodObject<S>;
  destructive?: boolean;
  cliOnly?: boolean;
  tui?: 'palette' | { view: string };
  run(args: z.infer<z.ZodObject<S>>, ctx: CommandContext): Promise<CommandResult<D>>;
}): CommandDef<D> {
  return def as unknown as CommandDef<D>;
}

export function getCommand(name: string): CommandDef | undefined {
  return registry.get(name);
}

export function allCommands(): CommandDef[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** test-only: clears the registry between tests. */
export function _resetRegistry(): void {
  registry.clear();
}
