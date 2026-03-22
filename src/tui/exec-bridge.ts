import { fork, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_BIN = join(__dirname, '..', '..', 'dist', 'index.js');

export interface CommandResult {
  ok: boolean;
  output: string;
}

export function runFleetCommand(args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = execFile('node', [FLEET_BIN, ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, output: stderr || err.message });
      } else {
        resolve({ ok: true, output: stdout });
      }
    });
  });
}

export function runFleetJson<T>(args: string[]): Promise<T | null> {
  return runFleetCommand([...args, '--json']).then(result => {
    if (!result.ok) return null;
    try {
      return JSON.parse(result.output) as T;
    } catch {
      return null;
    }
  });
}

export interface StreamHandle {
  kill: () => void;
  onData: (cb: (line: string) => void) => void;
}

export function streamFleetCommand(args: string[]): StreamHandle {
  const child = execFile('node', [FLEET_BIN, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const callbacks: Array<(line: string) => void> = [];

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      for (const cb of callbacks) cb(line);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      for (const cb of callbacks) cb(line);
    }
  });

  return {
    kill: () => child.kill(),
    onData: (cb) => callbacks.push(cb),
  };
}
