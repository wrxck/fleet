/**
 * Login attempt throttle for the backup explorer's TOTP endpoint.
 *
 * A refilling token bucket caps how many `/api/login` attempts can be made per
 * window. TOTP has only ~1e6 codes and `verifyTotp` accepts a ±1 step window
 * (3 live codes at any moment), so without a cap an attacker reachable through
 * the public `/backups` path could brute-force the second factor online. The
 * service is single-operator, so a single global bucket is sufficient and
 * avoids trusting a spoofable client IP.
 */
export interface LoginThrottle {
  /** consume one attempt; false means the bucket is empty (return 429). */
  take(nowMs: number): boolean;
  /** refund an attempt — called after a SUCCESSFUL login so a legitimate
   *  operator is never locked out by their own valid sign-ins. */
  refund(): void;
}

export interface ThrottleOptions {
  /** max attempts per window (bucket capacity). default 5. */
  capacity?: number;
  /** window in ms over which the bucket fully refills. default 60_000. */
  windowMs?: number;
}

export function createLoginThrottle(opts: ThrottleOptions = {}): LoginThrottle {
  const capacity = opts.capacity ?? 5;
  const windowMs = opts.windowMs ?? 60_000;
  let tokens = capacity;
  let last: number | null = null;

  return {
    take(nowMs: number): boolean {
      if (last !== null) {
        const elapsed = nowMs - last;
        if (elapsed > 0) tokens = Math.min(capacity, tokens + (elapsed / windowMs) * capacity);
      }
      last = nowMs;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    refund(): void {
      tokens = Math.min(capacity, tokens + 1);
    },
  };
}
