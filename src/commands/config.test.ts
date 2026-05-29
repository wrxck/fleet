import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { configCommand, whoamiCommand } from './config';
import { _resetOperatorCache } from '../core/operator';

const ctx = {
  confirm: async () => true,
  log: () => {},
  env: process.env,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fleet-config-test-'));
  writeFileSync(join(dir, 'operator.json'), JSON.stringify({
    username: 'op',
    homeDir: '/home/op',
    domain: 'fleet.test',
    githubOrg: 'op-org',
  }));
  process.env.FLEET_OPERATOR_PATH = join(dir, 'operator.json');
  _resetOperatorCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FLEET_OPERATOR_PATH;
  _resetOperatorCache();
});

describe('fleet config', () => {
  it('show prints the full operator config', async () => {
    const args = configCommand.args.parse({ action: 'show' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.data.config?.username).toBe('op');
    expect(r.data.config?.domain).toBe('fleet.test');
  });

  it('defaults to show when no action given', async () => {
    const args = configCommand.args.parse({});
    const r = await configCommand.run(args, ctx);
    expect(r.data.action).toBe('show');
    expect(r.ok).toBeTruthy();
  });

  it('get <field> returns a single value', async () => {
    const args = configCommand.args.parse({ action: 'get', field: 'domain' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.summary).toBe('fleet.test');
    expect(r.data.value).toBe('fleet.test');
  });

  it('get with unknown field fails', async () => {
    const args = configCommand.args.parse({ action: 'get', field: 'nope' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
    expect(r.summary).toMatch(/unknown field/);
  });

  it('get without a field fails', async () => {
    const args = configCommand.args.parse({ action: 'get' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
  });

  it('set <field> <value> persists to disk', async () => {
    const args = configCommand.args.parse({ action: 'set', field: 'domain', value: 'new.example' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    const onDisk = JSON.parse(readFileSync(join(dir, 'operator.json'), 'utf-8')) as { domain: string };
    expect(onDisk.domain).toBe('new.example');
  });

  it('set with unknown field fails', async () => {
    const args = configCommand.args.parse({ action: 'set', field: 'nope', value: 'x' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
    expect(r.summary).toMatch(/unknown field/);
  });

  it('set without a value fails', async () => {
    const args = configCommand.args.parse({ action: 'set', field: 'domain' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
  });

  it('set with an empty value returns the usage message', async () => {
    const args = configCommand.args.parse({ action: 'set', field: 'domain', value: '' });
    const r = await configCommand.run(args, ctx);
    expect(r.ok).toBeFalsy();
    expect(r.summary).toMatch(/fleet config set/);
  });
});

describe('fleet whoami', () => {
  it('returns the operator identity', async () => {
    const args = whoamiCommand.args.parse({});
    const r = await whoamiCommand.run(args, ctx);
    expect(r.ok).toBeTruthy();
    expect(r.data.username).toBe('op');
    expect(r.data.domain).toBe('fleet.test');
    expect(r.data.githubOrg).toBe('op-org');
    expect(r.summary).toMatch(/op @ fleet\.test/);
  });
});
