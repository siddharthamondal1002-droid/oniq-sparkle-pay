/**
 * P5 — a fetch that gives up.
 *
 * ONIQ's client makes a handful of calls to free, public, best-effort services
 * (map geocoding and routing). Those can stall indefinitely, and a stalled
 * `fetch` never rejects — it just hangs, which surfaces as a spinner that never
 * resolves. This wraps `fetch` with a deadline: after `timeoutMs` the request
 * is aborted, `fetch` rejects, and the caller's own error/fallback path runs.
 *
 * Deliberately minimal and browser-first (it is the client-side counterpart to
 * supabase/functions/_shared/fetchTimeout.ts). If the caller already passed a
 * signal, the timeout still wins — whichever aborts first ends the request.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour a caller-supplied signal too: abort ours if theirs fires.
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
