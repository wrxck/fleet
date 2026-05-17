import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadRegistry } from '../registry/index';
import { allCommands } from '../registry/registry';
import { makeMcpContext } from '../registry/context';

export interface BridgeTool {
  toolName: string;
  summary: string;
  cliOnly?: boolean;
}

/**
 * the mcp tool name for a registry command. ':' namespacing is not legal in
 * tool names, so subcommands collapse to underscores. this string is the
 * cross-surface contract, so both bridge functions derive it the same way.
 */
function toMcpToolName(commandName: string): string {
  return 'fleet_' + commandName.replace(/:/g, '_');
}

/** registry commands as flat tool descriptors, for inspection and tests. */
export function collectRegistryTools(): BridgeTool[] {
  loadRegistry();
  return allCommands()
    .filter(def => !def.cliOnly)
    .map(def => ({ toolName: toMcpToolName(def.name), summary: def.summary }));
}

/** registers every non-cliOnly registry command as an mcp tool. */
export function registerRegistryTools(server: McpServer): void {
  loadRegistry();
  for (const def of allCommands()) {
    if (def.cliOnly) continue;
    server.tool(toMcpToolName(def.name), def.summary, def.args.shape, async (args: Record<string, unknown>) => {
      // `confirm` is mcp surface plumbing, not a command arg — read it from the
      // raw input before the schema parse below strips unknown keys.
      const ctx = makeMcpContext(args.confirm === true);
      try {
        // validate, coerce and default args against the command schema — the
        // same safeParse the cli dispatcher runs via parseArgs, so both
        // surfaces invoke `run` with an identically-validated args shape.
        const parsed = def.args.safeParse(args);
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map(iss => `${iss.path.join('.')}: ${iss.message}`)
            .join('; ');
          return {
            content: [{ type: 'text' as const, text: `invalid arguments: ${detail}` }],
            isError: true,
          };
        }
        const result = await def.run(parsed.data, ctx);
        return {
          content: [{ type: 'text' as const, text: result.summary }],
          // structuredContent must be an object — only attach it when the
          // command actually returned one, otherwise the sdk rejects the shape.
          ...(result.data && typeof result.data === 'object'
            ? { structuredContent: result.data as Record<string, unknown> }
            : {}),
          isError: !result.ok,
        };
      } catch (err) {
        // the bridge is the single funnel for every migrated command — a
        // thrown handler must still surface as a structured tool failure,
        // not an opaque transport-level rejection.
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    });
  }
}
