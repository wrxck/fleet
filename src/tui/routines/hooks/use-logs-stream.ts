import { spawn } from 'node:child_process';
import { useEffect, useRef, useState } from 'react';

import type { LogLine } from '@matthesketh/ink-log-viewer';

const LEVEL_PATTERNS: [RegExp, LogLine['level']][] = [
  [/\b(error|err|failed|fatal)\b/i, 'error'],
  [/\b(warn|warning)\b/i, 'warn'],
  [/\b(debug|trace)\b/i, 'debug'],
];

function classify(line: string): LogLine['level'] {
  for (const [pattern, level] of LEVEL_PATTERNS) {
    if (pattern.test(line)) return level;
  }
  return 'info';
}

export interface LogsStreamOptions {
  command: string;
  args: string[];
  bufferSize?: number;
}

export interface LogsStream {
  lines: LogLine[];
  running: boolean;
  error: string | null;
  restart(): void;
}

export function useLogsStream(opts: LogsStreamOptions | null): LogsStream {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const bufferSize = opts?.bufferSize ?? 500;
  const lineBufferRef = useRef('');

  useEffect(() => {
    if (!opts) { setLines([]); setRunning(false); return; }
    setLines([]);
    setError(null);
    setRunning(true);
    lineBufferRef.current = '';

    const child = spawn(opts.command, opts.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const append = (chunk: string): void => {
      lineBufferRef.current += chunk;
      let idx: number;
      const newLines: LogLine[] = [];
      while ((idx = lineBufferRef.current.indexOf('\n')) >= 0) {
        const text = lineBufferRef.current.slice(0, idx);
        lineBufferRef.current = lineBufferRef.current.slice(idx + 1);
        if (!text.trim()) continue;
        newLines.push({ text, level: classify(text), timestamp: new Date() });
      }
      if (newLines.length > 0) {
        setLines(prev => {
          const combined = [...prev, ...newLines];
          return combined.length > bufferSize ? combined.slice(-bufferSize) : combined;
        });
      }
    };

    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', err => { setError(err.message); setRunning(false); });
    child.on('close', () => setRunning(false));

    return () => {
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000);
    };
  }, [opts?.command, opts?.args.join(' '), bufferSize, version]);

  return { lines, running, error, restart: () => setVersion(v => v + 1) };
}
