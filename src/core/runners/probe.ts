import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { shquote, sshConnectFlags } from './ssh';
import type { RemoteHost } from './types';

const execFileP = promisify(execFile);

export interface RunnerProbe {
  reachable: boolean;
  os: string | null;
  node: string | null;
  xcode: string | null; // developer dir path, or null when only command line tools / none
  diskFreeGb: number | null;
  raw: string;
}

// injectable so the probe can be unit-tested without a real ssh server.
export type ProbeExec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ProbeExec = (cmd, args) =>
  execFileP(cmd, args, { timeout: 30_000 }) as Promise<{ stdout: string }>;

// a single remote command that prints labelled lines the probe parses back.
// runs in a login shell so brew-managed node resolves; xcode-select reports
// whether full xcode (not just command line tools) is present.
function probeScript(): string {
  return [
    'echo "os=$(uname -s)/$(uname -m)"',
    'if command -v node >/dev/null 2>&1; then echo "node=$(node -v)"; else echo node=none; fi',
    'echo "xcode=$(xcode-select -p 2>/dev/null || echo none)"',
    'echo "diskfree=$(df -g $HOME 2>/dev/null | awk \'NR==2{print $4}\')"',
  ].join('; ');
}

export function parseProbe(out: string): Pick<RunnerProbe, 'os' | 'node' | 'xcode' | 'diskFreeGb'> {
  const get = (k: string): string | null => {
    const m = out.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  const orNull = (v: string | null): string | null => (v && v !== 'none' ? v : null);
  // a command line tools install is not a full xcode — treat it as no xcode.
  const xcodeRaw = orNull(get('xcode'));
  const xcode = xcodeRaw && xcodeRaw.includes('CommandLineTools') ? null : xcodeRaw;
  const diskRaw = get('diskfree');
  const diskNum = diskRaw ? parseInt(diskRaw, 10) : NaN;
  return {
    os: orNull(get('os')),
    node: orNull(get('node')),
    xcode,
    diskFreeGb: Number.isFinite(diskNum) ? diskNum : null,
  };
}

export async function probeRunner(host: RemoteHost, exec: ProbeExec = defaultExec): Promise<RunnerProbe> {
  // `--` ends ssh option parsing so the destination can never be read as a flag.
  const args = [...sshConnectFlags(host), '--', host.destination, `zsh -lc ${shquote(probeScript())}`];
  try {
    const { stdout } = await exec('ssh', args);
    return { reachable: true, raw: stdout, ...parseProbe(stdout) };
  } catch (e) {
    return {
      reachable: false,
      raw: e instanceof Error ? e.message : String(e),
      os: null,
      node: null,
      xcode: null,
      diskFreeGb: null,
    };
  }
}
