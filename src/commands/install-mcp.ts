import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

const FLEET_DIST = resolve(join(import.meta.dirname!, '..', '..', 'dist', 'index.js'));

interface ClaudeConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  [key: string]: unknown;
}

function getClaudeConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  return join(home, '.claude.json');
}

function loadConfig(path: string): ClaudeConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export const installMcpCommand = defineCommand({
  name: 'install-mcp',
  summary: 'Install fleet as a Claude Code MCP server',
  args: z.object({ uninstall: z.boolean().default(false) }),
  cliOnly: true,
  async run(args, ctx): Promise<CommandResult<{ installed: boolean }>> {
    const configPath = getClaudeConfigPath();
    const config = loadConfig(configPath);

    if (args.uninstall) {
      if (config.mcpServers?.fleet) {
        delete config.mcpServers.fleet;
        if (Object.keys(config.mcpServers).length === 0) {
          delete config.mcpServers;
        }
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        return {
          ok: true,
          summary: 'Removed fleet MCP server from Claude Code',
          data: { installed: false },
        };
      } else {
        return {
          ok: true,
          summary: 'fleet MCP server not configured — nothing to remove',
          data: { installed: false },
        };
      }
    }

    if (!existsSync(FLEET_DIST)) {
      ctx.log({ level: 'warn', message: 'dist/index.js not found — run "npm run build" first' });
    }

    config.mcpServers = config.mcpServers || {};
    const existed = !!config.mcpServers.fleet;
    config.mcpServers.fleet = {
      command: 'node',
      args: [FLEET_DIST, 'mcp'],
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    let summary: string;
    if (existed) {
      summary = 'Updated fleet MCP server in Claude Code';
    } else {
      summary = 'Installed fleet MCP server to Claude Code';
    }
    ctx.log({ level: 'info', message: `Config: ${configPath}` });
    ctx.log({ level: 'info', message: `Server: node ${FLEET_DIST} mcp` });

    return {
      ok: true,
      summary,
      data: { installed: true },
    };
  },
});
