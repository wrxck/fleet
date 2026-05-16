import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./secrets.js', () => ({
  loadManifest: vi.fn(),
  decryptApp: vi.fn(),
  sealApp: vi.fn(),
  VAULT_DIR: '/tmp/vault-test',
  // performRotation now wraps its body in lockManifest. In tests we don't
  // want real file locks; pass through to the callback synchronously.
  lockManifest: vi.fn(async (fn: () => unknown | Promise<unknown>) => await fn()),
}));
vi.mock('./secrets-snapshots.js', () => ({
  snapshotApp: vi.fn(() => '/tmp/snap.age'),
  restoreSnapshot: vi.fn(),
}));
vi.mock('./secrets-audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('./secrets-metadata.js', () => ({ markRotated: vi.fn() }));

import {
  maskNewValue,
  validateFormat,
  checkEntropy,
  parseEnv,
  serialiseEnv,
  applyRotation,
  performRotation,
} from './secrets-rotation.js';
import { classifySecret } from './secrets-providers.js';
import { loadManifest, decryptApp, sealApp } from './secrets.js';
import { snapshotApp, restoreSnapshot } from './secrets-snapshots.js';
import { markRotated } from './secrets-metadata.js';
import { auditLog } from './secrets-audit.js';

describe('maskNewValue', () => {
  it('masks short values', () => {
    expect(maskNewValue('abc')).toBe('*** (3 chars)');
  });
  it('masks medium values with start/end', () => {
    expect(maskNewValue('abcdefgh')).toBe('ab***gh (8 chars)');
  });
  it('masks long values with prefix and suffix', () => {
    const v = 'sk_live_' + 'a'.repeat(50);
    expect(maskNewValue(v)).toMatch(/^sk_l…aaaa \(58 chars\)$/);
  });
  it('never reveals more than 8 chars total of a long value', () => {
    const v = 'a'.repeat(100);
    const out = maskNewValue(v);
    // Strip the descriptor for the calculation
    const visible = out.replace(/ \(\d+ chars\)$/, '').replace('…', '');
    expect(visible.length).toBeLessThanOrEqual(8);
  });
});

describe('validateFormat', () => {
  it('passes a valid Stripe key', () => {
    const p = classifySecret('STRIPE_SECRET_KEY');
    expect(validateFormat('sk_live_' + 'a'.repeat(50), p)).toBeNull();
  });
  it('rejects a malformed Stripe key', () => {
    const p = classifySecret('STRIPE_SECRET_KEY');
    expect(validateFormat('not_a_key', p)).toMatch(/does not match/);
  });
  it('passes anything when provider has no format', () => {
    const p = classifySecret('JWT_SECRET');  // dual-mode, no format
    expect(validateFormat('anything-goes-here', p)).toBeNull();
  });
});

describe('checkEntropy', () => {
  it('flags placeholders', () => {
    expect(checkEntropy('changeme')).toMatch(/placeholder/);
    expect(checkEntropy('TODO')).toMatch(/placeholder/);
    expect(checkEntropy('password')).toMatch(/placeholder/);
  });
  it('flags too-short values', () => {
    expect(checkEntropy('abc')).toMatch(/too short/);
  });
  it('flags all-same-char strings', () => {
    expect(checkEntropy('xxxxxxxxxxxx')).toMatch(/same character/);
  });
  it('passes a real-looking secret', () => {
    expect(checkEntropy('sk_live_' + 'a'.repeat(50))).toBeNull();
  });
});

describe('parseEnv / serialiseEnv', () => {
  it('round-trips a simple env', () => {
    const t = '# comment\nFOO=bar\n\nBAZ=qux\n';
    const lines = parseEnv(t);
    expect(serialiseEnv(lines)).toBe(t);
  });
  it('preserves comments and blank lines', () => {
    const t = '# top\nA=1\n# inline\nB=2';
    const lines = parseEnv(t);
    expect(lines.filter(l => l.kind === 'raw')).toHaveLength(2);
  });
  it('handles values with = inside', () => {
    const lines = parseEnv('URL=postgres://u:p@h:5432/db?ssl=true');
    expect(lines[0]).toEqual({ kind: 'kv', key: 'URL', value: 'postgres://u:p@h:5432/db?ssl=true' });
  });
});

describe('applyRotation', () => {
  it('immediate replaces the value', () => {
    const out = applyRotation('FOO=old\nBAR=keep', 'FOO', 'new', 'immediate');
    expect(out).toBe('FOO=new\nBAR=keep');
  });

  it('dual-mode preserves old as _PREVIOUS', () => {
    const out = applyRotation('JWT_SECRET=old\nBAR=keep', 'JWT_SECRET', 'new', 'dual-mode');
    expect(out).toBe('JWT_SECRET=new\nJWT_SECRET_PREVIOUS=old\nBAR=keep');
  });

  it('dual-mode updates existing _PREVIOUS', () => {
    const out = applyRotation(
      'JWT_SECRET=v2\nJWT_SECRET_PREVIOUS=v1\nBAR=keep',
      'JWT_SECRET',
      'v3',
      'dual-mode',
    );
    expect(out).toBe('JWT_SECRET=v3\nJWT_SECRET_PREVIOUS=v2\nBAR=keep');
  });

  it('throws on missing key', () => {
    expect(() => applyRotation('FOO=bar', 'NOPE', 'x', 'immediate')).toThrow(/not found/);
  });

  it('preserves comments', () => {
    const t = '# header\nFOO=old\n# trailing';
    expect(applyRotation(t, 'FOO', 'new', 'immediate')).toBe('# header\nFOO=new\n# trailing');
  });
});

describe('performRotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadManifest).mockReturnValue({
      version: 1,
      apps: {
        macpool: {
          type: 'env',
          encryptedFile: 'macpool.env.age',
          sourceFile: '/tmp/x',
          lastSealedAt: '2026-04-01T00:00:00Z',
          keyCount: 2,
        },
      },
    });
    vi.mocked(decryptApp).mockReturnValue('STRIPE_SECRET_KEY=sk_old\nFOO=bar');
  });

  it('snapshots before sealing', async () => {
    await performRotation('macpool', 'STRIPE_SECRET_KEY', 'sk_live_' + 'a'.repeat(50));
    expect(snapshotApp).toHaveBeenCalledWith('macpool');
    expect(sealApp).toHaveBeenCalled();
    expect(markRotated).toHaveBeenCalledWith(
      'macpool',
      'STRIPE_SECRET_KEY',
      expect.objectContaining({ strategy: 'immediate' }),
    );
  });

  it('rolls back on seal failure', async () => {
    vi.mocked(sealApp).mockImplementationOnce(() => { throw new Error('disk full'); });
    const r = await performRotation('macpool', 'STRIPE_SECRET_KEY', 'sk_live_' + 'a'.repeat(50));
    expect(r.rolledBack).toBe(true);
    expect(restoreSnapshot).toHaveBeenCalledWith('macpool');
    expect(r.reason).toMatch(/disk full/);
  });

  it('refuses to rotate at-rest keys without --data-migrated', async () => {
    await expect(
      performRotation('macpool', 'ENCRYPTION_KEY', 'newvalue1234567'),
    ).rejects.toThrow(/Re-encrypt your data first/);
  });

  it('accepts at-rest rotation with explicit dataMigrated:true', async () => {
    vi.mocked(decryptApp).mockReturnValue('ENCRYPTION_KEY=oldvalue\n');
    await performRotation('macpool', 'ENCRYPTION_KEY', 'newvalue1234567', { dataMigrated: true });
    expect(sealApp).toHaveBeenCalled();
  });

  it('does NOT accept --data-migrated as substring in free-text notes (post-review fix)', async () => {
    vi.mocked(decryptApp).mockReturnValue('ENCRYPTION_KEY=oldvalue\n');
    await expect(
      performRotation('macpool', 'ENCRYPTION_KEY', 'newvalue1234567', {
        notes: 'see ticket #42: --data-migrated documentation update',
      }),
    ).rejects.toThrow(/Re-encrypt your data first/);
  });

  it('refuses user-issued rotations', async () => {
    await expect(
      performRotation('macpool', 'USER_API_TOKEN', 'whatever12345'),
    ).rejects.toThrow(/user-issued/);
  });

  it('dry-run does not snapshot or seal', async () => {
    const r = await performRotation('macpool', 'STRIPE_SECRET_KEY', 'sk_live_' + 'a'.repeat(50), { dryRun: true });
    expect(r.snapshot).toBe('(dry-run)');
    expect(snapshotApp).not.toHaveBeenCalled();
    expect(sealApp).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'rotate-attempted', details: 'dry-run' }),
    );
  });

  it('audit log fires on success and failure', async () => {
    await performRotation('macpool', 'STRIPE_SECRET_KEY', 'sk_live_' + 'a'.repeat(50));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ op: 'rotate', ok: true }));

    vi.mocked(sealApp).mockImplementationOnce(() => { throw new Error('boom'); });
    await performRotation('macpool', 'STRIPE_SECRET_KEY', 'sk_live_' + 'a'.repeat(50));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ op: 'rotate-failed', ok: false }));
  });
});
