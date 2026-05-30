// shared between the daemon (binds the socket) and the connect proxy (dials it).
// kept dependency-free so the unprivileged proxy does not pull in the server graph.

export const DEFAULT_SOCKET_PATH = '/run/fleet-mcp/mcp.sock';
export const GUARD_GROUP = 'fleet-guard';

export function socketPath(): string {
  return process.env.FLEET_MCP_SOCKET || DEFAULT_SOCKET_PATH;
}
