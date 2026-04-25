/**
 * Provider registry: maps secret names to provider metadata used by
 * `fleet secrets rotate` and `fleet secrets ages`.
 *
 * Adding a new provider: append to PROVIDERS. Order matters — the FIRST
 * matching entry wins, so put more specific patterns before generic ones.
 *
 * Strategy reference:
 *   - immediate     : replace value, old dies instantly. Safe for upstream API keys.
 *   - dual-mode     : new value becomes primary, old is kept as <NAME>_PREVIOUS for a
 *                     grace period so existing user sessions/tokens still verify.
 *                     Requires app code to read the _PREVIOUS variant as a fallback.
 *   - at-rest-key   : encrypts data sitting in storage. Rotating without re-encrypting
 *                     bricks the data. Refused unless --data-migrated is passed.
 *   - user-issued   : tokens YOU give to YOUR users. Rotating yours doesn't help —
 *                     redirected to per-user rotation tooling.
 */

export type RotationStrategy = 'immediate' | 'dual-mode' | 'at-rest-key' | 'user-issued';
export type Sensitivity = 'low' | 'medium' | 'high' | 'critical';

export interface ProviderDef {
  /** Stable id for manifest persistence. */
  id: string;
  /** Pattern matched against the secret name (env var key). */
  matches: RegExp;
  /** Human label shown in the UI. */
  name: string;
  /** Where to go to regenerate this secret. */
  url?: string;
  /** Numbered, copy-pasteable rotation steps. */
  instructions?: string;
  /** Format the new value should match. Used to validate paste. */
  format?: RegExp;
  /** Severity if this leaks. Drives MOTD ordering. */
  sensitivity: Sensitivity;
  /** How often this secret should be rotated, in days. Drives staleness. */
  rotationFrequencyDays: number;
  /** How rotation should be performed. See file header. */
  strategy: RotationStrategy;
  /** Optional: pretty companion env var name for dual-mode rotations. */
  previousVarName?: (varName: string) => string;
}

const previousAsSuffix = (n: string) => `${n}_PREVIOUS`;

export const PROVIDERS: ProviderDef[] = [
  // ── Stripe ───────────────────────────────────────────────────────────────
  {
    id: 'stripe-secret-key',
    matches: /^STRIPE_SECRET_KEY$/,
    name: 'Stripe Secret Key',
    url: 'https://dashboard.stripe.com/apikeys',
    instructions:
      '1. Click "Create secret key"\n' +
      '2. Set restrictions if desired (recommended: standard)\n' +
      '3. Copy the new sk_live_... value and paste below\n' +
      '4. After confirming the new key works, revoke the old one in the dashboard',
    format: /^sk_(live|test)_[A-Za-z0-9]{40,}$/,
    sensitivity: 'critical',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },
  {
    id: 'stripe-restricted-key',
    matches: /^STRIPE_RESTRICTED_KEY$/,
    name: 'Stripe Restricted Key',
    url: 'https://dashboard.stripe.com/apikeys',
    format: /^rk_(live|test)_[A-Za-z0-9]{40,}$/,
    sensitivity: 'high',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },
  {
    id: 'stripe-webhook-secret',
    matches: /^STRIPE_WEBHOOK_SECRET$/,
    name: 'Stripe Webhook Signing Secret',
    url: 'https://dashboard.stripe.com/webhooks',
    instructions:
      '1. Click your webhook endpoint\n' +
      '2. Click "Roll secret"\n' +
      '3. Copy the new whsec_... value and paste below',
    format: /^whsec_[A-Za-z0-9]{20,}$/,
    sensitivity: 'high',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },

  // ── GitHub ───────────────────────────────────────────────────────────────
  {
    id: 'github-pat-classic',
    matches: /^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT)$/,
    name: 'GitHub Personal Access Token',
    url: 'https://github.com/settings/tokens',
    instructions:
      '1. Click "Generate new token (classic)" or use a fine-grained token\n' +
      '2. Match the scopes/permissions of the existing token\n' +
      '3. Copy the new ghp_... or github_pat_... value and paste below\n' +
      '4. Delete the old token from the same page once confirmed working',
    format: /^(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})$/,
    sensitivity: 'critical',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },

  // ── AI providers ─────────────────────────────────────────────────────────
  {
    id: 'anthropic-api-key',
    matches: /^ANTHROPIC_API_KEY$/,
    name: 'Anthropic API Key',
    url: 'https://console.anthropic.com/settings/keys',
    format: /^sk-ant-[A-Za-z0-9_\-]{40,}$/,
    sensitivity: 'high',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },
  {
    id: 'openai-api-key',
    matches: /^OPENAI_API_KEY$/,
    name: 'OpenAI API Key',
    url: 'https://platform.openai.com/api-keys',
    format: /^sk-(proj-)?[A-Za-z0-9_\-]{20,}$/,
    sensitivity: 'high',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },

  // ── Google ───────────────────────────────────────────────────────────────
  {
    id: 'google-oauth-client-secret',
    matches: /^(GOOGLE_CLIENT_SECRET|GOOGLE_OAUTH_CLIENT_SECRET)$/,
    name: 'Google OAuth Client Secret',
    url: 'https://console.cloud.google.com/apis/credentials',
    instructions:
      '1. Open the OAuth 2.0 Client ID for this app\n' +
      '2. Add a new client secret (Google now supports multiple)\n' +
      '3. Paste the new GOCSPX-... value below\n' +
      '4. Delete the old secret from the same page after verifying',
    format: /^GOCSPX-[A-Za-z0-9_\-]{20,}$/,
    sensitivity: 'high',
    rotationFrequencyDays: 180,
    strategy: 'immediate',
  },
  {
    id: 'google-api-key',
    matches: /^(GOOGLE_API_KEY|GMAPS_API_KEY|GEMINI_API_KEY)$/,
    name: 'Google API Key',
    url: 'https://console.cloud.google.com/apis/credentials',
    format: /^AIza[0-9A-Za-z_\-]{35}$/,
    sensitivity: 'medium',
    rotationFrequencyDays: 180,
    strategy: 'immediate',
  },
  {
    id: 'gmail-app-password',
    matches: /^(EMAIL_SERVER_PASSWORD|GMAIL_APP_PASSWORD|SMTP_PASS|SMTP_PASSWORD)$/,
    name: 'Gmail App Password / SMTP Password',
    url: 'https://myaccount.google.com/apppasswords',
    instructions:
      '1. Sign in and create a new App Password (e.g. "macpool-2026")\n' +
      '2. Copy the 16-character value and paste below WITHOUT spaces\n' +
      '3. Revoke the old App Password from the same page',
    // Gmail app passwords are 16 lowercase alphanumeric chars. Google
    // displays them with spaces every 4 chars for readability but expects
    // them WITHOUT spaces in the SMTP password field — we accept only the
    // de-spaced form so a paste-as-displayed gets rejected with a clear error.
    format: /^[a-z0-9]{16}$/,
    sensitivity: 'critical',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },

  // ── App-internal cryptographic secrets (DUAL-MODE — preserves user sessions) ─
  {
    id: 'jwt-secret',
    matches: /^(JWT_SECRET|JWT_SIGNING_SECRET|JWT_PRIVATE_KEY)$/,
    name: 'JWT Signing Secret',
    instructions:
      'Generate a fresh high-entropy value (e.g. `openssl rand -base64 64`).\n' +
      'NOTE: Your app must read JWT_SECRET_PREVIOUS as a fallback verifier so\n' +
      'existing tokens stay valid through the grace period.',
    sensitivity: 'critical',
    rotationFrequencyDays: 180,
    strategy: 'dual-mode',
    previousVarName: previousAsSuffix,
  },
  {
    id: 'nextauth-secret',
    matches: /^(NEXTAUTH_SECRET|AUTH_SECRET)$/,
    name: 'NextAuth / Auth.js Secret',
    instructions:
      'Generate with `openssl rand -base64 64`.\n' +
      'NextAuth supports multiple secrets in v5; configure both new and previous so\n' +
      'logged-in users remain logged in.',
    sensitivity: 'critical',
    rotationFrequencyDays: 180,
    strategy: 'dual-mode',
    previousVarName: previousAsSuffix,
  },
  {
    id: 'session-secret',
    matches: /^(SESSION_SECRET|COOKIE_SECRET|EXPRESS_SESSION_SECRET)$/,
    name: 'Session / Cookie Signing Secret',
    instructions: 'Generate with `openssl rand -base64 64`.',
    sensitivity: 'high',
    rotationFrequencyDays: 180,
    strategy: 'dual-mode',
    previousVarName: previousAsSuffix,
  },
  {
    id: 'csrf-secret',
    matches: /^(CSRF_SECRET|CSRF_TOKEN_SECRET)$/,
    name: 'CSRF Token Secret',
    instructions: 'Generate with `openssl rand -base64 64`.',
    sensitivity: 'medium',
    rotationFrequencyDays: 180,
    strategy: 'dual-mode',
    previousVarName: previousAsSuffix,
  },

  // ── Encryption-at-rest (REFUSED unless --data-migrated) ──────────────────
  {
    id: 'data-encryption-key',
    matches: /^(ENCRYPTION_KEY|DATA_ENCRYPTION_KEY|FIELD_ENCRYPTION_KEY|AT_REST_KEY)$/,
    name: 'At-Rest Data Encryption Key',
    instructions:
      'WARNING: Rotating this without re-encrypting stored data will make the data\n' +
      'unreadable. Re-encrypt all data with the new key BEFORE rotation, then run:\n' +
      '  fleet secrets rotate <app> <KEY> --data-migrated',
    sensitivity: 'critical',
    rotationFrequencyDays: 365,
    strategy: 'at-rest-key',
  },

  // ── Bookwhen (used by macpool) ───────────────────────────────────────────
  {
    id: 'bookwhen-token',
    matches: /^BOOKWHEN_API_TOKEN$/,
    name: 'Bookwhen API Token',
    url: 'https://bookwhen.com/account/api',
    sensitivity: 'medium',
    rotationFrequencyDays: 180,
    strategy: 'immediate',
  },

  // ── Database connection strings ──────────────────────────────────────────
  {
    id: 'database-url',
    matches: /^(DATABASE_URL|MONGO_URL|REDIS_URL|POSTGRES_URL|MYSQL_URL)$/,
    name: 'Database Connection String',
    instructions:
      'Update the password component only — keep host, port, db unchanged.\n' +
      'Rotate the underlying DB user password first, then update this URL.',
    sensitivity: 'critical',
    rotationFrequencyDays: 180,
    strategy: 'immediate',
  },

  // ── AWS ──────────────────────────────────────────────────────────────────
  {
    id: 'aws-access-key',
    matches: /^AWS_ACCESS_KEY_ID$/,
    name: 'AWS Access Key ID',
    url: 'https://console.aws.amazon.com/iam/home#/security_credentials',
    format: /^AKIA[0-9A-Z]{16}$/,
    sensitivity: 'critical',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },
  {
    id: 'aws-secret-key',
    matches: /^AWS_SECRET_ACCESS_KEY$/,
    name: 'AWS Secret Access Key',
    url: 'https://console.aws.amazon.com/iam/home#/security_credentials',
    format: /^[A-Za-z0-9/+=]{40}$/,
    sensitivity: 'critical',
    rotationFrequencyDays: 90,
    strategy: 'immediate',
  },

  // ── Tokens we issue to OUR users (refused — rotate per user) ─────────────
  {
    id: 'user-issued-token',
    matches: /^(USER_API_TOKEN|CUSTOMER_API_KEYS|TENANT_TOKENS)$/,
    name: 'User-Issued Token',
    instructions:
      'These are tokens YOU issue to YOUR users. Rotating yours does nothing — you\n' +
      'need a per-user revocation flow in your app to invalidate them.',
    sensitivity: 'high',
    rotationFrequencyDays: 365,
    strategy: 'user-issued',
  },

  // ── Generic fallback ─────────────────────────────────────────────────────
  // Anything looking like a secret name but not specifically known.
  // Require an explicit `_` boundary before the suffix (so `MONKEY` and
  // `BROKEN_KEY` no longer match) and exclude `PUBLIC_KEY` / `PUB_KEY`
  // which are not secrets despite ending in KEY.
  {
    id: 'generic-secret',
    matches: /^(?!.*(?:PUBLIC_KEY|PUB_KEY)$).*_(SECRET|TOKEN|KEY|PASSWORD|PRIVATE)$/i,
    name: 'Generic Secret',
    instructions: 'Generate a fresh high-entropy value, e.g. `openssl rand -base64 32`.',
    sensitivity: 'medium',
    rotationFrequencyDays: 180,
    strategy: 'immediate',
  },
];

/** Find the provider definition that matches the given secret name. */
export function classifySecret(name: string): ProviderDef | null {
  for (const p of PROVIDERS) {
    if (p.matches.test(name)) return p;
  }
  return null;
}

/** Look up by stored provider id (for round-tripping after manifest persistence). */
export function getProviderById(id: string): ProviderDef | null {
  return PROVIDERS.find(p => p.id === id) ?? null;
}

/** Days since a timestamp. Null if invalid. */
export function ageInDays(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const ms = Date.now() - t;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** True if the secret is older than its provider's rotationFrequencyDays. */
export function isStale(age: number | null, provider: ProviderDef | null): boolean {
  if (age == null || provider == null) return false;
  return age >= provider.rotationFrequencyDays;
}
