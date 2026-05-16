import type { z } from 'zod';

/** a renderable model each surface turns into text (cli) or components (tui). */
export type RenderModel =
  | { kind: 'lines'; lines: string[] }
  | { kind: 'keyValue'; pairs: Array<[string, string]> }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'tree'; root: TreeNode };

export interface TreeNode {
  label: string;
  children?: TreeNode[];
}

/** the surface-agnostic result every command handler returns. */
export interface CommandResult<D = unknown> {
  ok: boolean;
  summary: string;
  data: D;
  render?: RenderModel;
}

/** surface-neutral services passed to every handler. */
export interface CommandContext {
  confirm(prompt: string): Promise<boolean>;
  log(event: { level: 'info' | 'warn' | 'error'; message: string }): void;
  env: NodeJS.ProcessEnv;
}

/** a command defined once; all three surfaces are derived from this. the
 *  registry stores the erased form — `run` receives the already-parsed args
 *  as a plain record. use `defineCommand` for inference at definition sites. */
export interface CommandDef<D = unknown> {
  name: string;
  summary: string;
  args: z.ZodObject<z.ZodRawShape>;
  destructive?: boolean;
  cliOnly?: boolean;
  tui?: 'palette' | { view: string };
  run(args: Record<string, unknown>, ctx: CommandContext): Promise<CommandResult<D>>;
}
