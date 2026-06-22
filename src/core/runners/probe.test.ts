import { describe, expect, it } from 'vitest';

import { parseProbe, probeRunner } from './probe';

describe('parseProbe', () => {
  it('parses a full macOS probe with xcode and disk', () => {
    const out = ['os=Darwin/arm64', 'node=v25.8.2', 'xcode=/Applications/Xcode.app/Contents/Developer', 'diskfree=120'].join('\n');
    expect(parseProbe(out)).toEqual({ os: 'Darwin/arm64', node: 'v25.8.2', xcode: '/Applications/Xcode.app/Contents/Developer', diskFreeGb: 120 });
  });

  it('treats command line tools as no full xcode, and none as null', () => {
    const out = ['os=Darwin/arm64', 'node=none', 'xcode=/Library/Developer/CommandLineTools', 'diskfree='].join('\n');
    expect(parseProbe(out)).toEqual({ os: 'Darwin/arm64', node: null, xcode: null, diskFreeGb: null });
  });
});

describe('probeRunner', () => {
  it('marks reachable and parses the output when ssh succeeds', async () => {
    const exec = async () => ({ stdout: 'os=Darwin/arm64\nnode=v25.8.2\nxcode=none\ndiskfree=8\n' });
    const p = await probeRunner({ destination: 'matt@host' }, exec);
    expect(p.reachable).toBeTruthy();
    expect(p.node).toBe('v25.8.2');
    expect(p.xcode).toBeNull();
    expect(p.diskFreeGb).toBe(8);
  });

  it('marks unreachable and captures the error when ssh fails', async () => {
    const exec = async () => { throw new Error('Connection refused'); };
    const p = await probeRunner({ destination: 'matt@host', port: 2222 }, exec);
    expect(p.reachable).toBeFalsy();
    expect(p.raw).toContain('Connection refused');
  });
});
