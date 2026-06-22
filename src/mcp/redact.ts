// best-effort scrubber for free-text error/reason strings before they are
// persisted to the audit log. not a guarantee — paired with first-line + a hard
// cap so a stray secret in e.g. docker build stderr does not accumulate on disk.
// the live caller response is never scrubbed; this is audit-log only.

const AGE_KEY = /AGE-SECRET-KEY-1[0-9A-Z]+/g;
// secret-looking assignment: NAME containing key/token/secret/pass(word)/pwd = value
const SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*)\s*[=:]\s*(\S+)/gi;
// long high-entropy run (hex / base64-ish), 32+ chars
const HIGH_ENTROPY = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
const MAX_LEN = 300;

export function scrubForAudit(text: string): string {
  if (!text) return '';
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  // redact first, THEN cap — capping before redaction could leave a half-
  // truncated secret at the boundary unredacted, defeating the point.
  let out = firstLine
    .replace(AGE_KEY, '[redacted-age-key]')
    .replace(SECRET_ASSIGN, (_m, key: string) => `${key}=[redacted]`)
    .replace(HIGH_ENTROPY, '[redacted]');
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '…';
  return out;
}
