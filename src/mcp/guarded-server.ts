import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Guard } from './guard';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

// pull an error message out of a tool result that signalled failure via
// isError, so the guard can audit it as a failure (handlers return rather than
// throw, so without this a failed call is mis-recorded as a success).
function errorTextFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as { isError?: unknown; content?: unknown };
  if (r.isError !== true) return undefined;
  if (!Array.isArray(r.content)) return 'tool reported an error';
  const joined = r.content
    .map(c => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string')
      ? (c as { text: string }).text : '')
    .filter(Boolean)
    .join(' ');
  return joined || 'tool reported an error';
}

// wrap a tool handler so the guard authorises the call, audits the outcome, and
// blocks execution when policy or rate limits deny it. the mcp server always
// passes the request extra as the handler's final argument, so a schema tool is
// invoked as (args, extra) and a no-arg tool as (extra) — tool args are therefore
// present only when the handler receives two or more arguments.
function wrapHandler(name: string, guard: Guard, original: (...a: unknown[]) => unknown) {
  return async (...callArgs: unknown[]): Promise<unknown> => {
    const toolArgs = callArgs.length >= 2 ? callArgs[0] : {};
    const decision = guard.authorize(name, toolArgs);
    if (!decision.ok) return text(`Denied by fleet guard: ${decision.reason}`);
    const start = Date.now();
    try {
      const result = await original(...callArgs);
      guard.complete(name, toolArgs, { durationMs: Date.now() - start, error: errorTextFromResult(result) });
      return result;
    } catch (err) {
      guard.complete(name, toolArgs, { durationMs: Date.now() - start, error: (err as Error).message });
      throw err;
    }
  };
}

// return a proxy over an mcp server whose tool() registrations are transparently
// guarded. every other property delegates to the underlying server, which is the
// object that should be passed to connect().
export function guarded(server: McpServer, guard: Guard): McpServer {
  return new Proxy(server, {
    get(target, prop, recv) {
      if (prop === 'tool') {
        return (...args: unknown[]) => {
          const cb = args[args.length - 1];
          if (typeof cb === 'function') {
            args[args.length - 1] = wrapHandler(String(args[0]), guard, cb as (...a: unknown[]) => unknown);
          }
          return (target.tool as (...a: unknown[]) => unknown)(...args);
        };
      }
      const val = Reflect.get(target, prop, recv);
      return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val;
    },
  }) as McpServer;
}
