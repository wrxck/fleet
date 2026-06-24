import type { RemoteHost } from './types';

// an ssh destination is either `user@host` or a bare ssh_config alias. only
// letters, digits and `._-` are permitted, so the value can never be parsed by
// ssh as an option (e.g. `-oProxyCommand=...`) and never carries shell-special
// characters. a literal `--` separator is also placed before the destination at
// the call sites as a structural backstop.
const DESTINATION_RE = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/;

export function assertDestination(dest: string): void {
  if (dest.startsWith('-')) {
    throw new Error(`ssh destination must not start with "-": ${JSON.stringify(dest)}`);
  }
  if (!DESTINATION_RE.test(dest)) {
    throw new Error(
      `invalid ssh destination ${JSON.stringify(dest)}: expected "user@host" or an ssh_config alias (letters, digits, ._-)`,
    );
  }
}

// identityFile and defaultCwd are passed to ssh as the value of a preceding flag
// (`-i <file>`) or shell-quoted into the remote command, so they cannot inject a
// flag — but we still reject a leading dash and any control character as
// defence in depth and to keep a tampered registry from smuggling odd values.
function assertPathLike(label: string, value: string): void {
  if (value.startsWith('-')) {
    throw new Error(`${label} must not start with "-": ${JSON.stringify(value)}`);
  }
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20) {
      throw new Error(`${label} must not contain control characters`);
    }
  }
}

// validates every connection-bearing field of a host. throws on the first
// invalid field. used on register (reject bad input early) and on load (fail
// closed against a tampered registry).
export function validateHost(host: RemoteHost): void {
  if (!host || typeof host.destination !== 'string') {
    throw new Error('runner host is missing a destination');
  }
  assertDestination(host.destination);
  if (host.identityFile !== undefined) assertPathLike('identityFile', host.identityFile);
  if (host.defaultCwd !== undefined) assertPathLike('defaultCwd', host.defaultCwd);
  if (host.port !== undefined && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)) {
    throw new Error(`invalid ssh port: ${String(host.port)}`);
  }
}

// like validateHost but returns a boolean instead of throwing — for filtering
// untrusted registry entries on load.
export function isValidHost(host: RemoteHost): boolean {
  try {
    validateHost(host);
    return true;
  } catch {
    return false;
  }
}
