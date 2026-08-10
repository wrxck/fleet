/**
 * redaction configuration: global defaults, per-app overrides, and the safety
 * layer around operator-supplied regexes.
 *
 * operator patterns are untrusted input executed against every log line, so
 * they are screened for redos shapes, compiled defensively, capped in count
 * and length, and never allowed to throw out of `fleet logs`.
 */

import { randomBytes } from 'node:crypto';

import { DEFAULT_CATEGORIES, type CategoryName } from './redaction-rules';
import type { AppEntry } from './registry';

/** the shape an operator writes into the registry. all fields optional. */
export interface RedactionUserConfig {
  /** master switch. default true. */
  enabled?: boolean;
  /** toggle individual built-ins. unlisted categories keep their defaults. */
  categories?: Partial<Record<CategoryName, boolean>>;
  /** extra operator patterns. group 1 is redacted when present, else the whole match. */
  customPatterns?: Array<{ name: string; pattern: string; flags?: string }>;
  /**
   * literal strings, or `/regex/flags`, that are never redacted. wins over
   * every built-in and custom pattern. this is the escape hatch when a false
   * positive turns up in production.
   */
  allowlist?: string[];
  /** append a short salted fingerprint to placeholders. default true. */
  fingerprint?: boolean;
}

export interface CompiledCustomPattern {
  name: string;
  re: RegExp;
}

/** a fully-resolved config, produced by `resolveRedaction`. */
export interface RedactionConfig {
  readonly resolved: true;
  enabled: boolean;
  categories: Record<CategoryName, boolean>;
  customPatterns: CompiledCustomPattern[];
  allowlist: RegExp[];
  fingerprint: boolean;
  /** per-process random salt. never persisted, so no cross-run rainbow table. */
  fingerprintSalt: string;
  /** lines longer than this are hidden from custom patterns (redos bound). */
  maxCustomLineLength: number;
  /** non-fatal problems found while compiling operator config. */
  warnings: string[];
}

const PROCESS_SALT = randomBytes(32).toString('hex');

const MAX_CUSTOM_PATTERNS = 32;
const MAX_CUSTOM_PATTERN_SOURCE = 1000;
const DEFAULT_MAX_CUSTOM_LINE = 4096;

/** placeholders are permanently allowlisted, which is what makes redaction idempotent. */
const PLACEHOLDER_RE = /\[REDACTED:[A-Za-z0-9_]{1,64}(?:#[0-9a-f]{4})?\]/g;

/**
 * heuristic redos screen: reject a quantified group whose body itself carries
 * an unbounded quantifier, e.g. `(a+)+`, `(\s*\w*)*`, `([a-z]+\d*){2,}`. that
 * is the shape that goes exponential. not a proof of safety, but paired with
 * the per-line length cap it keeps the worst case bounded.
 */
export function hasNestedUnboundedQuantifier(source: string): boolean {
  let inClass = false;
  const openStack: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') { i++; continue; }
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '(') { openStack.push(i); continue; }
    if (ch !== ')') continue;
    const open = openStack.pop();
    if (open === undefined) continue;
    if (!/^(?:[*+]|\{\d+,\})/.test(source.slice(i + 1))) continue;
    if (containsUnboundedQuantifier(source.slice(open + 1, i))) return true;
  }
  return false;
}

function containsUnboundedQuantifier(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') { i++; continue; }
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '*' || ch === '+') return true;
    if (ch === '{' && /^\{\d+,\}/.test(body.slice(i))) return true;
  }
  return false;
}

/**
 * compile operator patterns. never throws: a bad pattern is dropped with a
 * warning so `fleet logs` degrades rather than dying.
 */
export function compileCustomPatterns(
  patterns: Array<{ name: string; pattern: string; flags?: string }> | undefined,
  warnings: string[],
): CompiledCustomPattern[] {
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const out: CompiledCustomPattern[] = [];
  for (const p of patterns) {
    if (out.length >= MAX_CUSTOM_PATTERNS) {
      warnings.push(`redaction: ignoring custom patterns beyond the first ${MAX_CUSTOM_PATTERNS}`);
      break;
    }
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
      warnings.push(`redaction: custom pattern name "${name}" must match [A-Za-z0-9_]{1,64}, skipped`);
      continue;
    }
    if (typeof p?.pattern !== 'string' || p.pattern.length === 0) {
      warnings.push(`redaction: custom pattern "${name}" has no pattern, skipped`);
      continue;
    }
    if (p.pattern.length > MAX_CUSTOM_PATTERN_SOURCE) {
      warnings.push(`redaction: custom pattern "${name}" exceeds ${MAX_CUSTOM_PATTERN_SOURCE} chars, skipped`);
      continue;
    }
    if (hasNestedUnboundedQuantifier(p.pattern)) {
      warnings.push(`redaction: custom pattern "${name}" has a nested unbounded quantifier (redos risk), skipped`);
      continue;
    }
    const flags = (p.flags ?? '').replace(/[^imsu]/g, '');
    let re: RegExp;
    try {
      re = new RegExp(p.pattern, `${flags}gd`);
      // a pattern matching the empty string would produce a span per position.
      if (new RegExp(p.pattern, flags).test('')) {
        warnings.push(`redaction: custom pattern "${name}" matches the empty string, skipped`);
        continue;
      }
    } catch (e) {
      warnings.push(`redaction: custom pattern "${name}" failed to compile (${(e as Error).message}), skipped`);
      continue;
    }
    out.push({ name, re });
  }
  return out;
}

/** compile an allowlist entry. `/re/flags` becomes a regex, anything else literal. */
export function compileAllowlist(entries: string[] | undefined, warnings: string[]): RegExp[] {
  const out: RegExp[] = [PLACEHOLDER_RE];
  for (const raw of entries ?? []) {
    if (typeof raw !== 'string' || raw === '') continue;
    const m = /^\/(.+)\/([imsu]*)$/s.exec(raw);
    if (!m) {
      out.push(new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gd'));
      continue;
    }
    if (hasNestedUnboundedQuantifier(m[1])) {
      warnings.push(`redaction: allowlist regex ${raw} has a nested unbounded quantifier, skipped`);
      continue;
    }
    try {
      out.push(new RegExp(m[1], `${m[2]}gd`));
    } catch (e) {
      warnings.push(`redaction: allowlist regex ${raw} failed to compile (${(e as Error).message}), skipped`);
    }
  }
  return out;
}

function isResolved(cfg: unknown): cfg is RedactionConfig {
  return !!cfg && typeof cfg === 'object' && (cfg as RedactionConfig).resolved === true;
}

/** normalise a user config (or nothing) into a fully-resolved config. */
export function resolveRedaction(cfg?: RedactionUserConfig | RedactionConfig | null): RedactionConfig {
  if (isResolved(cfg)) return cfg;
  const warnings: string[] = [];
  const user = cfg ?? {};
  return {
    resolved: true,
    enabled: user.enabled ?? true,
    categories: { ...DEFAULT_CATEGORIES, ...(user.categories ?? {}) },
    customPatterns: compileCustomPatterns(user.customPatterns, warnings),
    allowlist: compileAllowlist(user.allowlist, warnings),
    fingerprint: user.fingerprint ?? true,
    fingerprintSalt: PROCESS_SALT,
    maxCustomLineLength: DEFAULT_MAX_CUSTOM_LINE,
    warnings,
  };
}

/** module-wide defaults, resolved once. */
export const DEFAULT_REDACTION: RedactionConfig = resolveRedaction();

/** a resolved config that passes text through untouched. */
export const DISABLED_REDACTION: RedactionConfig = resolveRedaction({ enabled: false });

/**
 * per-app redaction config, mirroring `effectivePolicy` in logs-policy.ts.
 * reads `app.logging.redaction` first and falls back to `app.redaction`, so
 * either registry shape an operator reaches for works.
 */
export function effectiveRedaction(app: AppEntry): RedactionConfig {
  const raw = app.logging?.redaction ?? (app as { redaction?: RedactionUserConfig }).redaction;
  return raw ? resolveRedaction(raw) : DEFAULT_REDACTION;
}
