/**
 * GOOGLE'S OWN WORDS, WHATEVER SHAPE THEY ARRIVE IN.
 *
 * `voice-clone`'s probe exists because a bare status cannot tell a missing IAM
 * role from an allowlist refusal from a disabled API — all three arrive as 403,
 * and only the text separates them. On 2026-09-07 the owner ran the first real
 * POST and the probe answered:
 *
 *     {"status":404,"detail":"http 404","verdict":"UNEXPECTED 404 — read the detail"}
 *
 * "read the detail" — and the detail was a restatement of the status. The one
 * thing the probe was built to deliver was the one thing it dropped.
 *
 * WHY, measured the same hour with an unauthenticated curl to the same URL:
 * aiplatform answers this endpoint with a JSON **ARRAY** wrapping the error —
 *
 *     [{"error":{"code":401,"status":"UNAUTHENTICATED","message":"Request is
 *       missing required authentication credential. …"}}]
 *
 * The reader did `parsed?.error`, which is `undefined` on an array. Both fields
 * came back empty, the join produced "", and the `|| \`http ${status}\`` fallback
 * turned a real sentence into a placeholder.
 *
 * THE RULE THIS ENCODES: a diagnostic may never fall back to the status it was
 * built to explain. When no known shape matches, the RAW BODY goes back —
 * unparsed, truncated, ugly if need be. An unreadable sentence can still be
 * read by a person; `http 404` cannot be read by anyone.
 *
 * The same unauthenticated run also settles what the 404 is NOT. Both
 * wrong-path shapes were reproduced and neither is JSON:
 *
 *     POST v1/…/locations/global/voices      -> 404, EMPTY body
 *     POST v1beta1/…/locations/global/models -> 404, Google's HTML page
 *     POST v1beta1/…/locations/global/voices -> 401, JSON  (ONIQ's URL)
 *
 * ONIQ's URL reaches the auth check unauthenticated, so the route resolves and
 * POST is a defined method on it. And a 404 whose body PARSED as JSON cannot be
 * either wrong-path shape, because neither of those parses. So the 404 the
 * service account met is an application-level refusal with words attached —
 * which is exactly what the next tap will now print.
 */

/** Longest detail worth carrying back to a screen. */
const MAX = 500;

/**
 * Read an error out of a Vertex response.
 *
 * @param parsed the JSON-parsed body, or null if it would not parse
 * @param text   the raw body, always
 * @param status the HTTP status, used only to describe an empty body
 */
export function vertexErrorDetail(parsed: unknown, text: string, status: number): string {
  // The array wrapper is the shape that produced "http 404". Unwrap it first;
  // a plain object falls through unchanged.
  const node = Array.isArray(parsed) ? parsed[0] : parsed;
  const err = (node as { error?: unknown } | null | undefined)?.error;

  // `{"error":"Not Found"}` — a string, not the {status,message} object.
  if (typeof err === "string" && err.trim()) return err.trim().slice(0, MAX);

  const shaped = err as { status?: string; message?: string } | undefined;
  const joined = [shaped?.status, shaped?.message].filter(Boolean).join(": ").trim();
  if (joined) return joined.slice(0, MAX);

  // NO KNOWN SHAPE. The raw body is the answer, not the status. This branch is
  // the whole point of the module — it is what turns an unrecognised refusal
  // into something a person can read and act on.
  const raw = text.trim();
  if (raw) return raw.slice(0, MAX);

  // Genuinely nothing came back. Say THAT, and say it is unusual, rather than
  // echoing the status as though it were an explanation.
  return `http ${status} with an empty body`;
}
