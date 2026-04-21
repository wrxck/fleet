import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { RoutineTask, RunEvent } from '../../core/routines/schema.js';
import type { RunContext, RunnerAdapter } from '../types.js';

export interface McpCallOptions {
  command?: string;
  args?: string[];
  clientName?: string;
  clientVersion?: string;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const chunks: string[] = [];
  for (const part of content as { type?: string; text?: string }[]) {
    if (part.type === 'text' && typeof part.text === 'string') chunks.push(part.text);
  }
  return chunks.join('');
}

export function createMcpCallRunner(opts: McpCallOptions = {}): RunnerAdapter {
  const command = opts.command ?? 'fleet';
  const args = opts.args ?? ['mcp'];

  return {
    id: 'mcp-call',

    supports(task: RoutineTask): boolean {
      return task.kind === 'mcp-call';
    },

    async *run(
      task: RoutineTask,
      ctx: RunContext,
      signal: AbortSignal,
    ): AsyncIterable<RunEvent> {
      if (task.kind !== 'mcp-call') throw new Error('mcp-call runner received wrong task kind');

      const startedAt = new Date().toISOString();
      const startTime = Date.now();
      yield { kind: 'start', routineId: ctx.routineId, target: ctx.repo ?? null, at: startedAt };

      const transport = new StdioClientTransport({ command, args });
      const client = new Client(
        { name: opts.clientName ?? 'fleet-routine', version: opts.clientVersion ?? '1.0.0' },
        { capabilities: {} },
      );

      const timer = setTimeout(() => {
        void transport.close().catch(() => { /* already closed */ });
      }, task.wallClockMs);

      const onAbort = (): void => {
        void transport.close().catch(() => { /* already closed */ });
      };
      signal.addEventListener('abort', onAbort);

      let errorText: string | undefined;
      let status: 'ok' | 'failed' | 'timeout' | 'aborted' = 'failed';
      let exitCode = 1;

      try {
        await client.connect(transport);
        const result = await client.callTool({ name: task.tool, arguments: task.args });
        const payload = result as { content?: unknown; isError?: boolean };
        const text = extractText(payload.content);
        if (text) yield { kind: 'stdout', chunk: `${text}\n` };
        yield { kind: 'tool-call', name: task.tool, argsPreview: JSON.stringify(task.args).slice(0, 200) };
        if (payload.isError) {
          status = 'failed';
          errorText = text || 'mcp tool returned isError';
        } else {
          status = 'ok';
          exitCode = 0;
        }
      } catch (err) {
        errorText = (err as Error).message;
        status = signal.aborted ? 'aborted' : 'failed';
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        try { await client.close(); } catch { /* already closed */ }
        try { await transport.close(); } catch { /* already closed */ }
      }

      yield {
        kind: 'end',
        status,
        exitCode,
        durationMs: Date.now() - startTime,
        at: new Date().toISOString(),
        ...(errorText ? { error: errorText } : {}),
      };
    },
  };
}
