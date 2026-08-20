// fetchWithTimeout — a fetch that gives up instead of hanging a request on a
// slow or dead upstream.
//
// The read-only content proxies (faith-scripture, devotional-radio, mappls-geo)
// fan out to third-party APIs that have no contract with ONIQ. Every one of
// them already CATCHES a thrown error and degrades — an empty list, an
// "unavailable" shape, a fallback to Nominatim — but a socket that connects and
// then never answers throws nothing: it just holds the request open until the
// function's own wall-clock limit, turning one dead upstream into a stalled
// screen. AbortController closes the socket at the deadline so the existing
// catch/degrade path actually runs.
//
// It deliberately does NOT swallow the abort into a fake Response: the caller's
// own error handling is the right place to decide what a timeout means for that
// endpoint, and hiding it here would defeat the point.
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
