/**
 * automatic pii and secret redaction for log output.
 *
 * design contract, read before adding or loosening a pattern:
 *
 * false positives are worse than false negatives here. over-redaction destroys
 * the debuggability of production logs, which is the entire reason
 * `fleet logs` exists. every built-in pattern must be either anchored on a
 * vendor literal (AKIA, ghp_, sk-ant-), gated on a key name that means
 * "secret" (PASSWORD=, DSN:), or structurally validated (luhn, mod-97,
 * base64 decode, octet ranges). a bare high-entropy string is never redacted
 * on entropy alone: commit shas, uuids, image digests and build ids all look
 * exactly like that.
 *
 * performance: `readContainerLogs` is called with maxBytes up to 5_000_000.
 * the strategy is one linear scan per enabled category collecting spans, then
 * a single string rebuild from the merged span list. there is no repeated
 * string rewriting and no catastrophic backtracking. see redaction.test.ts for
 * the large-input budget test.
 *
 * ordering against grep: callers filter on raw text and redact afterwards, so
 * an operator grepping for a hostname still gets hits. see readContainerLogs
 * for the caveat that comes with that choice.
 */

import { createHash } from 'node:crypto';

import {
  resolveRedaction,
  type RedactionConfig,
  type RedactionUserConfig,
} from './redaction-config';
import { MATCHERS, PEM_BEGIN, PEM_END } from './redaction-rules';

export {
  CATEGORY_NAMES,
  DEFAULT_CATEGORIES,
  type CategoryName,
} from './redaction-rules';
export {
  DEFAULT_REDACTION,
  DISABLED_REDACTION,
  compileAllowlist,
  compileCustomPatterns,
  effectiveRedaction,
  hasNestedUnboundedQuantifier,
  resolveRedaction,
  type RedactionConfig,
  type RedactionUserConfig,
} from './redaction-config';

/** hard cap on spans per call so a runaway pattern cannot exhaust memory. */
const MAX_SPANS = 50_000;

interface Span {
  start: number;
  end: number;
  category: string;
  /** matcher index. lower wins ties. */
  rank: number;
}

export interface RedactionResult {
  text: string;
  /** redactions applied, keyed by category (built-in or custom pattern name). */
  counts: Record<string, number>;
}

function placeholderFor(category: string, value: string, cfg: RedactionConfig): string {
  if (!cfg.fingerprint) return `[REDACTED:${category}]`;
  const fp = createHash('sha256').update(cfg.fingerprintSalt).update(value).digest('hex').slice(0, 4);
  return `[REDACTED:${category}#${fp}]`;
}

function collectAllowlistSpans(text: string, cfg: RedactionConfig): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const re of cfg.allowlist) {
    try {
      for (const m of text.matchAll(re)) {
        if (m[0].length === 0) continue;
        out.push([m.index, m.index + m[0].length]);
        if (out.length >= MAX_SPANS) return out;
      }
    } catch { /* a pathological allowlist entry must never break log reading */ }
  }
  return out;
}

/** operator patterns run line by line so one huge line cannot be a redos lever. */
function runCustomPatterns(text: string, cfg: RedactionConfig, spans: Span[], rankBase: number): void {
  if (cfg.customPatterns.length === 0) return;
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    const len = lineEnd - lineStart;
    if (len > 0 && len <= cfg.maxCustomLineLength) {
      const line = text.slice(lineStart, lineEnd);
      for (let i = 0; i < cfg.customPatterns.length; i++) {
        const { name, re } = cfg.customPatterns[i];
        try {
          for (const m of line.matchAll(re)) {
            if (m[0].length === 0) continue;
            const span = m.indices?.[1] ?? m.indices?.[0];
            if (!span) continue;
            spans.push({ start: lineStart + span[0], end: lineStart + span[1], category: name, rank: rankBase + i });
            if (spans.length >= MAX_SPANS) return;
          }
        } catch { /* degrade, never crash */ }
      }
    }
    if (lineEnd >= text.length) break;
    lineStart = lineEnd + 1;
  }
}

/**
 * redact a block of text. pure and synchronous.
 *
 * returns the redacted text plus per-category counts. when redaction is
 * disabled, or nothing matched, the input string is returned byte-identical.
 */
export function redactText(
  text: string,
  cfg?: RedactionUserConfig | RedactionConfig | null,
): RedactionResult {
  const conf = resolveRedaction(cfg);
  if (!conf.enabled || text.length === 0) return { text, counts: {} };

  const spans: Span[] = [];
  for (let i = 0; i < MATCHERS.length; i++) {
    const m = MATCHERS[i];
    if (!conf.categories[m.name]) continue;
    if (m.prefilter && !m.prefilter(text)) continue;
    try {
      m.run(text, (start, end) => {
        if (spans.length < MAX_SPANS) spans.push({ start, end, category: m.name, rank: i });
      });
    } catch { /* a single matcher must never take down log reading */ }
  }
  runCustomPatterns(text, conf, spans, MATCHERS.length);
  if (spans.length === 0) return { text, counts: {} };

  // allowlist wins over everything, built-in and custom alike.
  const allowed = collectAllowlistSpans(text, conf);
  const kept = allowed.length === 0
    ? spans
    : spans.filter(s => !allowed.some(([a, b]) => s.start < b && a < s.end));
  if (kept.length === 0) return { text, counts: {} };

  // widest span at a given start wins, ties broken by matcher order.
  kept.sort((a, b) => (a.start - b.start) || (b.end - a.end) || (a.rank - b.rank));

  const counts: Record<string, number> = {};
  let out = '';
  let cursor = 0;
  for (const s of kept) {
    if (s.start < cursor) continue;
    out += text.slice(cursor, s.start);
    out += placeholderFor(s.category, text.slice(s.start, s.end), conf);
    counts[s.category] = (counts[s.category] ?? 0) + 1;
    cursor = s.end;
  }
  return { text: out + text.slice(cursor), counts };
}

/** single-line wrapper. pure. see `createLineRedactor` for multiline pem state. */
export function redactLine(line: string, cfg?: RedactionUserConfig | RedactionConfig | null): string {
  return redactText(line, cfg).text;
}

/** pem body lines: base64, or a header such as `Proc-Type: 4,ENCRYPTED`. */
const PEM_BODY = /^[A-Za-z0-9+/=\s]*$|^[A-Za-z-]+:[ \t]*\S+$/;
const PEM_MAX_BLOCK_LINES = 200;

/**
 * stateful per-line redactor for the streaming tail path.
 *
 * `redactLine` alone cannot hide a pem block, because the block spans many
 * lines and each arrives separately. this wrapper tracks "inside a private key
 * block" so the body is suppressed. it drops out of that state on a line that
 * does not look like pem content (interleaved stderr) or after
 * PEM_MAX_BLOCK_LINES, so a container that never emits an END marker cannot
 * blank the rest of the stream.
 */
export function createLineRedactor(
  cfg?: RedactionUserConfig | RedactionConfig | null,
): (line: string) => string {
  const conf = resolveRedaction(cfg);
  if (!conf.enabled) return (line: string) => line;
  let inBlock = false;
  let blockLines = 0;

  return (line: string): string => {
    if (!conf.categories.private_key) return redactText(line, conf).text;

    if (inBlock) {
      blockLines++;
      if (PEM_END.test(line)) { inBlock = false; blockLines = 0; return ''; }
      if (blockLines > PEM_MAX_BLOCK_LINES || !PEM_BODY.test(line)) {
        inBlock = false;
        blockLines = 0;
        return redactText(line, conf).text;
      }
      return '';
    }

    if (PEM_BEGIN.test(line) && !PEM_END.test(line)) {
      inBlock = true;
      blockLines = 0;
      const at = line.search(PEM_BEGIN);
      return redactText(line.slice(0, at), conf).text + placeholderFor('private_key', line.slice(at), conf);
    }

    return redactText(line, conf).text;
  };
}
