/**
 * fetch wrapper that aborts after `timeoutMs`.
 *
 * Used by collectors that hit third-party HTTP services (OSV, npm registry).
 * Without this, a hung peer would stall an entire scan indefinitely.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
