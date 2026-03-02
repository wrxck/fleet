import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { success, error, info, warn } from '../ui/output.js';

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

export async function installMcpCommand(args: string[]): Promise<void> {
  const uninstall = args.includes('--uninstall');
  const configPath = getClaudeConfigPath();
  const config = loadConfig(configPath);

  if (uninstall) {
    if (config.mcpServers?.fleet) {
      delete config.mcpServers.fleet;
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      success('Removed fleet MCP server from Claude Code');
    } else {
      info('fleet MCP server not configured — nothing to remove');
    }
    return;
  }

  if (!existsSync(FLEET_DIST)) {
    warn('dist/index.js not found — run "npm run build" first');
  }

  config.mcpServers = config.mcpServers || {};
  const existed = !!config.mcpServers.fleet;
  config.mcpServers.fleet = {
    command: 'node',
    args: [FLEET_DIST, 'mcp'],
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  if (existed) {
    success('Updated fleet MCP server in Claude Code');
  } else {
    success('Installed fleet MCP server to Claude Code');
  }
  info(`Config: ${configPath}`);
  info(`Server: node ${FLEET_DIST} mcp`);
}
