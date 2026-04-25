/**
 * Plain-text and hidden-input prompts, no external deps.
 *
 * promptHidden uses raw mode + manual char-by-char read so the echoed value
 * never appears on the terminal — important for pasting secrets and for
 * tools like `script` / asciinema.
 */

import * as readline from 'node:readline';

export async function prompt(message: string, defaultValue?: string): Promise<string> {
  const hint = defaultValue !== undefined ? ` [${defaultValue}]` : '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${message}${hint}: `, answer => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === '' && defaultValue !== undefined ? defaultValue : trimmed);
    });
  });
}

/**
 * Read a value from stdin without echoing characters. Returns when the user
 * presses Enter. Backspace is honoured. Ctrl-C aborts (rejects).
 *
 * If stdin is not a TTY (e.g. tests or piped input), falls back to a regular
 * line read so the function still works in CI / scripts.
 */
export function promptHidden(message: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin });
      process.stdout.write(message + ': ');
      rl.once('line', line => {
        rl.close();
        resolve(line);
      });
    });
  }

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(message + ': ');
    let buf = '';
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (data: string) => {
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(buf);
          return;
        } else if (code === 3) {              // Ctrl-C
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Cancelled'));
          return;
        } else if (code === 127 || code === 8) {  // Backspace / Del
          if (buf.length > 0) buf = buf.slice(0, -1);
        } else if (code >= 32) {               // printable
          buf += ch;
        }
        // Silently drop other control chars (escape sequences etc.).
      }
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    stdin.on('data', onData);
  });
}
