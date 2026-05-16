import type { CommandDef } from './types';

const registry = new Map<string, CommandDef>();

export function register(def: CommandDef): void {
  if (registry.has(def.name)) {
    throw new Error(`duplicate command registration: ${def.name}`);
  }
  registry.set(def.name, def);
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
