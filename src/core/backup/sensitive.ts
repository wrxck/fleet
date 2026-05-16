/** classifies a snapshot-relative path as holding secret material or not.
 *  used by the backup explorer to refuse view/download of sensitive files
 *  while still allowing them to be restored to a staging dir. */

export type Sensitivity = 'sensitive' | 'normal';

// matched case-insensitively against the full path.
const SENSITIVE_PATTERNS: RegExp[] = [
  // key material
  /\/\.ssh\//,
  /\/\.gnupg\//,
  /^\/etc\/ssh\//,
  /^\/etc\/letsencrypt\//,
  /\.pem$/,
  /\.key$/,
  // cloud + credential stores
  /\/\.aws\//,
  /\/\.gcloud\//,
  /\/\.azure\//,
  /\/\.kube\//,
  /\/\.docker\//,
  /\/\.secrets\//,
  /\/credentials/,
  /\/\.token/,
  /\/\.npmrc$/,
  /\/\.git-credentials$/,
  // fleet + agent secrets
  /\/\.claude/,
  /^\/var\/lib\/fleet\//,
  // database dumps
  /\.pg\.sql$/,
  /\.mysql\.sql$/,
  /\.mongo\.archive$/,
  /\.rdb$/,
  /\.sql$/,
];

export function classify(path: string): Sensitivity {
  const p = path.toLowerCase();
  return SENSITIVE_PATTERNS.some(re => re.test(p)) ? 'sensitive' : 'normal';
}
