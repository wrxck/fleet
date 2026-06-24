// secret-scrubbing for free-text strings (tool stderr, error messages) before
// they are shown to a caller or written to the audit log. best-effort, not a
// guarantee: it targets the secret shapes fleet actually handles so a stray
// value in e.g. `age` or `docker` stderr is not surfaced verbatim.

const AGE_KEY = /AGE-SECRET-KEY-1[0-9A-Z]+/g;

// secret-looking assignment: a NAME that names a credential = value. covers the
// key/token/secret/pass(word)/pwd family plus connection-string names
// (URL/URI/DSN/CONN) that carry embedded credentials.
const SECRET_ASSIGN =
  /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|URL|URI|DSN|CONN)[A-Za-z0-9_]*)\s*[=:]\s*(\S+)/gi;

// the password component of a URL, e.g. postgres://user:p4ss@host -> user:[redacted]@
const URL_CREDENTIAL = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi;

// a long high-entropy run (hex / base64-ish), 24+ chars. lowered from 32 so the
// shorter api tokens fleet's providers list classifies as critical are caught.
const HIGH_ENTROPY = /[A-Za-z0-9+/_-]{24,}={0,2}/g;

// scrubSecrets redacts secret material across the whole input, preserving line
// structure. use for live error/response strings returned to a caller.
export function scrubSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(AGE_KEY, '[redacted-age-key]')
    .replace(URL_CREDENTIAL, '$1[redacted]@')
    .replace(SECRET_ASSIGN, (_m, key: string) => `${key}=[redacted]`)
    .replace(HIGH_ENTROPY, '[redacted]');
}
