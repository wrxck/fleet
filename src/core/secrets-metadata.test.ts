import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./secrets.js', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
  listSecrets: vi.fn(),
}));

import {
  getSecretMetadata,
  setSecretMetadata,
  markRotated,
  enumerateSecrets,
  enumerateAllSecrets,
} from './secrets-metadata.js';
import { loadManifest, saveManifest, listSecrets } from './secrets.js';

const mockLoad = vi.mocked(loadManifest);
const mockSave = vi.mocked(saveManifest);
const mockList = vi.mocked(listSecrets);

function manifest(apps: Record<string, any>) {
  return { version: 1, apps };
}

describe('secrets-metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSecretMetadata', () => {
    it('returns null when app missing', () => {
      mockLoad.mockReturnValue(manifest({}));
      expect(getSecretMetadata('macpool', 'STRIPE_SECRET_KEY')).toBeNull();
    });

    it('returns null when secrets map missing', () => {
      mockLoad.mockReturnValue(manifest({ macpool: { lastSealedAt: '2026-01-01T00:00:00Z' } }));
      expect(getSecretMetadata('macpool', 'STRIPE_SECRET_KEY')).toBeNull();
    });

    it('returns the stored metadata', () => {
      mockLoad.mockReturnValue(
        manifest({
          macpool: {
            lastSealedAt: '2026-01-01T00:00:00Z',
            secrets: {
              STRIPE_SECRET_KEY: { lastRotated: '2026-04-25T00:00:00Z', provider: 'stripe-secret-key' },
            },
          },
        }),
      );
      const m = getSecretMetadata('macpool', 'STRIPE_SECRET_KEY');
      expect(m?.provider).toBe('stripe-secret-key');
    });
  });

  describe('setSecretMetadata', () => {
    it('throws if app missing', () => {
      mockLoad.mockReturnValue(manifest({}));
      expect(() => setSecretMetadata('nope', 'X', { lastRotated: 'now' })).toThrow(/No app/);
    });

    it('creates the secrets map and persists', () => {
      mockLoad.mockReturnValue(manifest({ macpool: { lastSealedAt: '2026-01-01T00:00:00Z' } }));
      setSecretMetadata('macpool', 'STRIPE_SECRET_KEY', {
        lastRotated: '2026-04-25T00:00:00Z',
        provider: 'stripe-secret-key',
      });
      const saved = mockSave.mock.calls[0][0];
      expect(saved.apps.macpool.secrets.STRIPE_SECRET_KEY.provider).toBe('stripe-secret-key');
    });
  });

  describe('markRotated', () => {
    it('writes a now-timestamp + auto-classifies provider', () => {
      mockLoad.mockReturnValue(manifest({ macpool: { lastSealedAt: '2026-01-01T00:00:00Z' } }));
      const m = markRotated('macpool', 'STRIPE_SECRET_KEY');
      expect(m.provider).toBe('stripe-secret-key');
      expect(m.strategy).toBe('immediate');
      expect(Date.parse(m.lastRotated)).toBeGreaterThan(Date.now() - 5000);
    });

    it('respects strategy override (e.g. dual-mode for unrecognised name)', () => {
      mockLoad.mockReturnValue(manifest({ macpool: { lastSealedAt: '2026-01-01T00:00:00Z' } }));
      const m = markRotated('macpool', 'WEIRD_KEY', { strategy: 'dual-mode' });
      expect(m.strategy).toBe('dual-mode');
    });
  });

  describe('enumerateSecrets', () => {
    it('falls back to lastSealedAt when no per-secret metadata', () => {
      mockLoad.mockReturnValue(
        manifest({ macpool: { lastSealedAt: '2026-01-01T00:00:00Z' } }),
      );
      mockList.mockReturnValue([{ key: 'STRIPE_SECRET_KEY', maskedValue: 'sk_***' }]);

      const out = enumerateSecrets('macpool');
      expect(out).toHaveLength(1);
      expect(out[0].lastRotated).toBe('2026-01-01T00:00:00Z');
      expect(out[0].provider?.id).toBe('stripe-secret-key');
      expect(out[0].ageDays).toBeGreaterThan(30);
      expect(out[0].stale).toBe(true);  // way older than 90d
    });

    it('uses per-secret lastRotated when present', () => {
      const recent = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
      mockLoad.mockReturnValue(
        manifest({
          macpool: {
            lastSealedAt: '2026-01-01T00:00:00Z',
            secrets: {
              STRIPE_SECRET_KEY: { lastRotated: recent, provider: 'stripe-secret-key' },
            },
          },
        }),
      );
      mockList.mockReturnValue([{ key: 'STRIPE_SECRET_KEY', maskedValue: 'sk_***' }]);

      const out = enumerateSecrets('macpool');
      expect(out[0].lastRotated).toBe(recent);
      expect(out[0].ageDays).toBeLessThanOrEqual(5);
      expect(out[0].stale).toBe(false);
    });

    it('throws for unknown app', () => {
      mockLoad.mockReturnValue(manifest({}));
      expect(() => enumerateSecrets('nope')).toThrow(/No app/);
    });
  });

  describe('enumerateAllSecrets', () => {
    it('aggregates across apps and tags app name', () => {
      mockLoad.mockReturnValue(
        manifest({
          macpool: { lastSealedAt: '2026-04-01T00:00:00Z' },
          shiftfaced: { lastSealedAt: '2026-04-15T00:00:00Z' },
        }),
      );
      mockList.mockImplementation((app: string) =>
        app === 'macpool'
          ? [{ key: 'STRIPE_SECRET_KEY', maskedValue: 'sk_***' }]
          : [{ key: 'JWT_SECRET', maskedValue: 'foo***' }],
      );

      const all = enumerateAllSecrets();
      expect(all.map(s => `${s.app}:${s.name}`).sort()).toEqual([
        'macpool:STRIPE_SECRET_KEY',
        'shiftfaced:JWT_SECRET',
      ]);
    });

    it('skips apps that fail to enumerate (e.g. missing key)', () => {
      mockLoad.mockReturnValue(
        manifest({
          good: { lastSealedAt: '2026-01-01T00:00:00Z' },
          broken: { lastSealedAt: '2026-01-01T00:00:00Z' },
        }),
      );
      mockList.mockImplementation((app: string) => {
        if (app === 'broken') throw new Error('boom');
        return [{ key: 'X', maskedValue: '***' }];
      });

      const all = enumerateAllSecrets();
      expect(all.map(s => s.app)).toEqual(['good']);
    });
  });
});
