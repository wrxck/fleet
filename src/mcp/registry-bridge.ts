import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loadRegistry } from '../registry/index';
import { allCommands } from '../registry/registry';
import { makeMcpContext } from '../registry/context';

export interface BridgeTool {
  toolName: string;
  summary: string;
  cliOnly?: boolean;
}

/** registry commands as flat tool descriptors, for inspection and tests. */
export function collectRegistryTools(): BridgeTool[] {
  loadRegistry();
  return allCommands()
    .filter(def => !def.cliOnly)
    .map(def => ({ toolName: 'fleet_' + def.name.replace(/:/g, '_'), summary: def.summary }));
}

/** registers every non-cliOnly registry command as an mcp tool. */
export function registerRegistryTools(server: McpServer): void {
  loadRegistry();
  for (const def of allCommands()) {
    if (def.cliOnly) continue;
    const toolName = 'fleet_' + def.name.replace(/:/g, '_');
    server.tool(toolName, def.summary, def.args.shape, async (args: Record<string, unknown>) => {
      const ctx = makeMcpContext(args.confirm === true);
      const result = await def.run(args, ctx);
      return {
        content: [{ type: 'text' as const, text: result.summary }],
        structuredContent: result.data as Record<string, unknown>,
        isError: !result.ok,
      };
    });
  }
}
