// audit-log scrubber for free-text error/reason strings. reduces to the first
// non-empty line, runs it through the shared secret scrubber, then caps length
// so a stray secret in e.g. docker build stderr does not accumulate on disk.
import { scrubSecrets } from '../core/redact';

const MAX_LEN = 300;

export function scrubForAudit(text: string): string {
  if (!text) return '';
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  // redact first, THEN cap — capping before redaction could leave a half-
  // truncated secret at the boundary unredacted, defeating the point.
  let out = scrubSecrets(firstLine);
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '…';
  return out;
}
