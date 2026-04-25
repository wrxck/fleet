import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  classifySecret,
  getProviderById,
  ageInDays,
  isStale,
} from './secrets-providers.js';

describe('secrets-providers', () => {
  describe('classifySecret', () => {
    it('classifies STRIPE_SECRET_KEY as stripe-secret-key', () => {
      const p = classifySecret('STRIPE_SECRET_KEY');
      expect(p?.id).toBe('stripe-secret-key');
      expect(p?.sensitivity).toBe('critical');
      expect(p?.strategy).toBe('immediate');
    });

    it('classifies STRIPE_WEBHOOK_SECRET as stripe-webhook-secret', () => {
      expect(classifySecret('STRIPE_WEBHOOK_SECRET')?.id).toBe('stripe-webhook-secret');
    });

    it('classifies BOOKWHEN_API_TOKEN', () => {
      expect(classifySecret('BOOKWHEN_API_TOKEN')?.id).toBe('bookwhen-token');
    });

    it.each([
      ['GITHUB_TOKEN', 'github-pat-classic'],
      ['GH_TOKEN', 'github-pat-classic'],
      ['GITHUB_PAT', 'github-pat-classic'],
    ])('classifies %s as github-pat-classic', (name, id) => {
      expect(classifySecret(name)?.id).toBe(id);
    });

    it.each([
      ['EMAIL_SERVER_PASSWORD', 'gmail-app-password'],
      ['GMAIL_APP_PASSWORD', 'gmail-app-password'],
      ['SMTP_PASS', 'gmail-app-password'],
      ['SMTP_PASSWORD', 'gmail-app-password'],
    ])('classifies %s as gmail-app-password', (name, id) => {
      expect(classifySecret(name)?.id).toBe(id);
    });

    it('classifies JWT_SECRET as dual-mode', () => {
      const p = classifySecret('JWT_SECRET');
      expect(p?.strategy).toBe('dual-mode');
      expect(p?.previousVarName?.('JWT_SECRET')).toBe('JWT_SECRET_PREVIOUS');
    });

    it('classifies NEXTAUTH_SECRET as dual-mode', () => {
      expect(classifySecret('NEXTAUTH_SECRET')?.strategy).toBe('dual-mode');
    });

    it('classifies AUTH_SECRET as dual-mode', () => {
      expect(classifySecret('AUTH_SECRET')?.strategy).toBe('dual-mode');
    });

    it('classifies SESSION_SECRET as dual-mode', () => {
      expect(classifySecret('SESSION_SECRET')?.strategy).toBe('dual-mode');
    });

    it('classifies ENCRYPTION_KEY as at-rest-key', () => {
      expect(classifySecret('ENCRYPTION_KEY')?.strategy).toBe('at-rest-key');
    });

    it('classifies USER_API_TOKEN as user-issued', () => {
      expect(classifySecret('USER_API_TOKEN')?.strategy).toBe('user-issued');
    });

    it('falls back to generic-secret for unknown patterns ending in SECRET/TOKEN/KEY', () => {
      expect(classifySecret('MY_RANDOM_API_KEY')?.id).toBe('generic-secret');
      expect(classifySecret('CUSTOM_TOKEN')?.id).toBe('generic-secret');
    });

    it('returns null for non-secret-looking names', () => {
      expect(classifySecret('NODE_ENV')).toBeNull();
      expect(classifySecret('DEBUG')).toBeNull();
      expect(classifySecret('PORT')).toBeNull();
    });

    it('specific patterns win over generic', () => {
      // STRIPE_SECRET_KEY ends in KEY which would match generic, but stripe wins
      expect(classifySecret('STRIPE_SECRET_KEY')?.id).toBe('stripe-secret-key');
    });
  });

  describe('format validation', () => {
    it('accepts a valid stripe standard live key', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(p.format!.test('sk_live_' + 'a'.repeat(50))).toBe(true);
    });

    it('accepts a valid stripe RESTRICTED live key (rk_live_...) — Stripe-recommended pattern', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(p.format!.test('rk_live_' + 'a'.repeat(50))).toBe(true);
      expect(p.format!.test('rk_test_' + 'a'.repeat(50))).toBe(true);
    });

    it('rejects malformed stripe keys', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(p.format!.test('not_a_real_key')).toBe(false);
      expect(p.format!.test('sk_live_short')).toBe(false);
      expect(p.format!.test('rk_live_short')).toBe(false);
    });

    it('accepts whsec_ webhook secrets', () => {
      const p = classifySecret('STRIPE_WEBHOOK_SECRET')!;
      expect(p.format!.test('whsec_' + 'A'.repeat(30))).toBe(true);
    });

    it('accepts ghp_ and github_pat_ tokens', () => {
      const p = classifySecret('GITHUB_TOKEN')!;
      expect(p.format!.test('ghp_' + 'a'.repeat(40))).toBe(true);
      expect(p.format!.test('github_pat_' + 'a'.repeat(60))).toBe(true);
    });

    it('AWS access key matches AKIA prefix exactly', () => {
      const p = classifySecret('AWS_ACCESS_KEY_ID')!;
      expect(p.format!.test('AKIA' + 'A'.repeat(16))).toBe(true);
      expect(p.format!.test('akia' + 'A'.repeat(16))).toBe(false);
    });
  });

  describe('getProviderById', () => {
    it('round-trips a stored provider id', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(getProviderById(p.id)?.id).toBe(p.id);
    });

    it('returns null for unknown id', () => {
      expect(getProviderById('does-not-exist')).toBeNull();
    });
  });

  describe('ageInDays', () => {
    it('returns 0 for now', () => {
      expect(ageInDays(new Date().toISOString())).toBe(0);
    });

    it('returns ~30 for 30 days ago', () => {
      const t = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const age = ageInDays(t);
      expect(age).toBeGreaterThanOrEqual(29);
      expect(age).toBeLessThanOrEqual(30);
    });

    it('returns null for undefined', () => {
      expect(ageInDays(undefined)).toBeNull();
    });

    it('returns null for invalid date', () => {
      expect(ageInDays('not a date')).toBeNull();
    });
  });

  describe('isStale', () => {
    it('not stale when age is fresh', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(isStale(10, p)).toBe(false);
    });

    it('stale when age >= rotationFrequencyDays', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(isStale(p.rotationFrequencyDays, p)).toBe(true);
      expect(isStale(p.rotationFrequencyDays + 1, p)).toBe(true);
    });

    it('not stale when age is null', () => {
      const p = classifySecret('STRIPE_SECRET_KEY')!;
      expect(isStale(null, p)).toBe(false);
    });

    it('not stale when provider is null', () => {
      expect(isStale(999, null)).toBe(false);
    });
  });

  describe('PROVIDERS sanity', () => {
    it('all ids are unique', () => {
      const ids = PROVIDERS.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all entries have positive rotationFrequencyDays', () => {
      for (const p of PROVIDERS) {
        expect(p.rotationFrequencyDays).toBeGreaterThan(0);
      }
    });

    it('every provider has a strategy', () => {
      for (const p of PROVIDERS) {
        expect(['immediate', 'dual-mode', 'at-rest-key', 'user-issued']).toContain(p.strategy);
      }
    });

    it('every dual-mode provider supplies a previousVarName function', () => {
      for (const p of PROVIDERS) {
        if (p.strategy === 'dual-mode') {
          expect(typeof p.previousVarName).toBe('function');
        }
      }
    });
  });
});
