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
 * String variant — convenience wrapper around the Buffer variant. Use the
 * Buffer variant directly if you want the strongest in-memory guarantees;
 * this one converts to string and the result lives in the V8 heap until GC.
 */
export async function promptHidden(message: string): Promise<string> {
  const buf = await promptHiddenBuffer(message);
  try {
    return buf.toString('utf8');
  } finally {
    buf.fill(0);
  }
}

/**
 * Buffer-based hidden input. Returns the raw input bytes in a Buffer the
 * caller is expected to zero out (`buf.fill(0)`) when finished — see
 * `withSecretBuffer` for an automated pattern.
 *
 * Why Buffer (not string)?
 *   - Node strings are immutable + interned in V8 heap; you can't zero them.
 *     Once a secret string exists, it sits in the heap until GC.
 *   - Buffer is a writable byte array. Calling `buf.fill(0)` overwrites the
 *     bytes in-place; subsequent heap dumps and core dumps contain zeros.
 *
 * Hardening:
 *   - Buffer is grown by `Buffer.concat` and the intermediate buffers are
 *     zeroed before being released.
 *   - Non-TTY fallback uses `terminal: false` so readline can never promote
 *     stdout to terminal mode and echo the value.
 *   - End/error/SIGINT all reject + restore terminal state and zero the
 *     in-flight buffer so a death never leaves bytes behind.
 *
 * KNOWN LIMITATION: any string copy made downstream (e.g. `buf.toString()`
 * for regex validation) lives in V8 heap until GC. Convert as late as
 * possible and let the string go out of scope ASAP.
 */
export function promptHiddenBuffer(message: string): Promise<Buffer> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      process.stdout.write(message + ': ');
      let done = false;
      const finish = (cb: () => void) => { if (done) return; done = true; rl.close(); cb(); };
      rl.once('line', line => finish(() => resolve(Buffer.from(line, 'utf8'))));
      rl.once('close', () => finish(() => reject(new Error('Cancelled (stdin closed)'))));
      rl.once('error', err => finish(() => reject(err)));
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(message + ': ');
    // Pre-allocate; grow geometrically to avoid quadratic Buffer.concat.
    let buf = Buffer.alloc(64);
    let len = 0;
    let settled = false;
    const wasRaw = stdin.isRaw;

    const grow = (need: number) => {
      if (len + need <= buf.length) return;
      const next = Buffer.alloc(Math.max(buf.length * 2, len + need));
      buf.copy(next);
      buf.fill(0);          // zero the old buffer before releasing
      buf = next;
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      process.removeListener('SIGINT', onSigint);
      try { stdin.setRawMode(wasRaw); } catch { /* terminal may be gone */ }
      stdin.pause();
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const wipeAndReject = (err: Error) => {
      buf.fill(0);
      settle(() => reject(err));
    };

    const onData = (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (c === 0x0d || c === 0x0a) {                    // \r \n
          process.stdout.write('\n');
          const out = Buffer.alloc(len);
          buf.copy(out, 0, 0, len);
          buf.fill(0);
          settle(() => resolve(out));
          return;
        } else if (c === 0x03) {                            // Ctrl-C
          process.stdout.write('\n');
          wipeAndReject(new Error('Cancelled'));
          return;
        } else if (c === 0x7f || c === 0x08) {              // backspace
          if (len > 0) { len -= 1; buf[len] = 0; }
        } else if (c >= 0x20) {                              // printable
          grow(1);
          buf[len++] = c;
        }
      }
    };
    const onEnd = () => wipeAndReject(new Error('Cancelled (stdin ended)'));
    const onError = (err: Error) => wipeAndReject(err);
    const onSigint = () => { process.stdout.write('\n'); wipeAndReject(new Error('Cancelled (SIGINT)')); };

    stdin.setRawMode(true);
    stdin.resume();
    // Note: do NOT setEncoding — we want raw bytes, not auto-decoded strings.
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    process.on('SIGINT', onSigint);
  });
}

/**
 * Recommended pattern for handling a secret in memory: read into a Buffer,
 * pass to your callback, zero on exit (success or throw). Use this instead
 * of `promptHidden` when the value will be processed by code under your
 * control end-to-end.
 *
 * Example:
 *   await withSecretBuffer('Paste new STRIPE_SECRET_KEY', async (buf) => {
 *     const asString = buf.toString('utf8');   // brief string copy
 *     await sealApp(app, applyRotation(...));   // age-encrypt happens here
 *     // String copy is unreferenced from this point; buf is zeroed on exit.
 *   });
 */
export async function withSecretBuffer<T>(
  message: string,
  fn: (value: Buffer) => Promise<T>,
): Promise<T> {
  const buf = await promptHiddenBuffer(message);
  try {
    return await fn(buf);
  } finally {
    buf.fill(0);
  }
}
