// A capability token for exactly one Story job, for exactly a few minutes.
//
// WHY THIS EXISTS. The render runs on a GitHub runner, and the runner has to
// tell Supabase how it went. The obvious way is to give GitHub the service-role
// key — which is the database's master key, bypasses every RLS policy, and
// would sit in a repository secret forever. For a job that only needs to move
// one row through four states, that is a spectacular over-grant.
//
// So the runner gets this instead: a signed string naming one job id and an
// expiry. It authorises nothing else. Someone who steals it can mark one
// already-running Story as failed, and that is the whole blast radius.
//
// HMAC, NOT A TABLE. A token row would need writing before dispatch, reading on
// every callback, and sweeping when jobs die — three more failure modes for
// something the signature already proves. Nothing is stored; the secret is the
// only state.
//
// IT TRAVELS IN A repository_dispatch PAYLOAD, which is readable by anyone with
// repo read access. That is the accepted cost and the reason for the short TTL
// and the single-job scope: the token is a receipt for work already claimed,
// not a key to the system.

const enc = new TextEncoder();

/** Long enough for a ten-minute Story plus runner boot, short enough to matter. */
export const JOB_TOKEN_TTL_MS = 60 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return b64url(new Uint8Array(sig));
}

/** `<jobId>.<expiresAtMs>.<signature>` */
export async function mintJobToken(
  jobId: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const body = `${jobId}.${now + JOB_TOKEN_TTL_MS}`;
  return `${body}.${await sign(body, secret)}`;
}

export type JobTokenResult = { ok: true; jobId: string } | { ok: false; reason: string };

/**
 * Verify a token and return the job it authorises.
 *
 * Compares signatures in CONSTANT TIME. A plain `===` on an HMAC leaks how many
 * leading bytes were right, one request at a time, which is enough to forge one
 * given patience — and a job token is exactly the sort of thing somebody would
 * be patient about.
 */
export async function verifyJobToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<JobTokenResult> {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [jobId, expiresAt, provided] = parts;

  const expected = await sign(`${jobId}.${expiresAt}`, secret);
  if (expected.length !== provided.length) return { ok: false, reason: "bad signature" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: "bad signature" };

  // Expiry is checked AFTER the signature, so an attacker cannot use timing on
  // this branch to learn whether a forged job id exists.
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || now > exp) return { ok: false, reason: "expired" };

  return { ok: true, jobId };
}
