import type { RemoteHost } from './types';

// posix single-quote escaping: wraps a value so a remote shell receives it as
// one literal argument whatever spaces or quotes it contains.
export function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// the ssh connection flags shared by the runner and the doctor probe: no
// password prompts (key-only), a bounded connect timeout, plus port/identity
// when the host specifies them.
export function sshConnectFlags(host: RemoteHost): string[] {
  const flags = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  if (host.port) flags.push('-p', String(host.port));
  if (host.identityFile) flags.push('-i', host.identityFile);
  return flags;
}
