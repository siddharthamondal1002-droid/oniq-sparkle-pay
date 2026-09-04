/**
 * AN OAUTH2 ACCESS TOKEN FOR GOOGLE CLOUD, from whichever credential exists.
 *
 * WHY THIS EXISTS. Voice replication runs on Vertex AI, which does not take
 * the API key ONIQ holds — it wants `Authorization: Bearer <token>`. Google's
 * own examples get that token with
 * `gcloud auth application-default print-access-token`, which is an
 * INTERACTIVE DEVELOPER command on a laptop: it opens a browser, and the
 * credential it produces belongs to a person.
 *
 * A SUPABASE EDGE FUNCTION HAS NO BROWSER AND NO gcloud. So the same identity
 * has to arrive a different way. There are exactly two ways it can, and this
 * module supports BOTH so that whichever the owner provisions simply works:
 *
 *   1. A SERVICE ACCOUNT. A JSON key with a private key in it; this signs a
 *      JWT and exchanges it for an access token. No human in the loop, which
 *      is what a server wants.
 *   2. AN OAUTH REFRESH TOKEN belonging to a real Google account — the same
 *      identity `gcloud auth application-default login` produces. The owner
 *      consents ONCE in a browser, the refresh token is stored as a secret,
 *      and this exchanges it for access tokens forever after.
 *
 * (2) is the honest answer to "a Google account is enough": it IS enough, but
 * the account's consent has to be captured once and stored, because a server
 * cannot ask a browser for it at request time. An email address on its own is
 * an identity, not a credential — nothing can authenticate as somebody from
 * their address alone.
 *
 * IN PRACTICE ONIQ TAKES (1). Owner directive 2026-09-04e chose the Firebase
 * project's service account; see serviceAccountJson below for what that
 * means for the bill and how to undo it.
 *
 * EITHER WAY A PROJECT ID IS STILL NEEDED — it is in the URL path and in the
 * `x-goog-user-project` header. A Gmail address does not imply a Cloud
 * project, and measured 2026-09-04, the API key does not echo one: the
 * response headers from an authenticated call carry no x-goog-* field naming
 * a project. But a SERVICE ACCOUNT JSON carries `project_id` inside it, so
 * when one is configured the project comes free and no second secret is
 * needed.
 *
 * MEASURED, so the API-key question is closed rather than assumed. Three
 * attempts against Vertex — `?key=`, an `x-goog-api-key` header, and a plain
 * GET — all returned 401 UNAUTHENTICATED / CREDENTIALS_MISSING: "API keys are
 * not supported by this API. Expected OAuth2 access token or other
 * authentication credentials that assert a principal." It fires BEFORE any
 * project or allowlist check — the placeholder project in the URL was never
 * evaluated — so this is a CREDENTIAL-TYPE problem, not an access one. No
 * arrangement of the key ONIQ holds will work here.
 *
 * NO SECRET IS EVER RETURNED, LOGGED, OR PUT IN AN ERROR. The functions here
 * return a token or a reason; the reason names which secret is MISSING, which
 * is operator information, never a value.
 */

// Imported by vitest (Node) as well as by the edge functions (Deno). The
// `| undefined` is load-bearing: it forces the typeof guard on the default
// argument below, so "no Deno here" is a value rather than a ReferenceError.
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Vertex needs this scope; it is the broad one Google's own examples use. */
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export type GoogleAuthMode = "service-account" | "refresh-token" | "none";

export type GoogleAuthStatus = {
  mode: GoogleAuthMode;
  projectId: string | null;
  /** True only when a token could actually be minted right now. */
  ready: boolean;
  /** Operator-facing, names what is missing. Never carries a value. */
  reason: string | null;
};

/**
 * The service-account JSON, from whichever secret holds one.
 *
 * OWNER DIRECTIVE, 2026-09-04e. Asked which credential Vertex should
 * authenticate as, and told plainly that the choice decides whose bill Vertex
 * charges, the owner chose the FIREBASE PROJECT. `FIREBASE_SERVICE_ACCOUNT`
 * is already provisioned and is a Google Cloud service-account key — a
 * Firebase project IS a Cloud project — so there is nothing new to create,
 * and Vertex spend lands on that project's billing account alongside
 * Firebase's own. That is the owner's call, made with the consequence stated,
 * which is why this file reaches for it by default now instead of waiting to
 * be opted in.
 *
 * THE OFF SWITCH SURVIVES THE DECISION. `GOOGLE_VERTEX_USE_FIREBASE_SA=false`
 * turns it off again without a deploy — the same discipline every spend
 * control here follows, because a decision about money should be reversible
 * by the person who made it rather than by whoever can ship code that day.
 *
 * A dedicated GOOGLE_SERVICE_ACCOUNT_JSON still wins over both, so moving
 * Vertex onto its own project later is one secret and no code change.
 */
function serviceAccountJson(env: (k: string) => string | undefined): string | undefined {
  const dedicated = env("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (dedicated) return dedicated;
  // A KILL SWITCH, AND KILL SWITCHES MUST BE EASY TO TRIP. Unset or empty
  // means the owner's directive stands and the key is used. Any of the
  // ordinary ways of writing "yes" also mean on. ANYTHING ELSE — "false",
  // "no", "0", "off", or a typo made at speed by somebody trying to stop the
  // spending — means OFF. The asymmetry is deliberate: a mistake in the "on"
  // direction costs a feature, a mistake in the "off" direction costs money.
  const raw = (env("GOOGLE_VERTEX_USE_FIREBASE_SA") ?? "").trim().toLowerCase();
  const on = raw === "" || raw === "true" || raw === "yes" || raw === "1" || raw === "on";
  return on ? env("FIREBASE_SERVICE_ACCOUNT") : undefined;
}

/** `project_id` out of a service-account JSON, without throwing on rubbish. */
function projectFromServiceAccount(json: string | undefined): string | null {
  if (!json) return null;
  try {
    const p = (JSON.parse(json) as { project_id?: unknown }).project_id;
    return typeof p === "string" && p ? p : null;
  } catch {
    return null;
  }
}

/** Which credential the environment holds, without minting anything. */
export function googleAuthStatus(env: (k: string) => string | undefined): GoogleAuthStatus {
  const sa = serviceAccountJson(env);
  // An explicit project wins; otherwise take the one inside the key, which is
  // by definition the project that key belongs to.
  const projectId =
    env("GOOGLE_CLOUD_PROJECT") ?? env("GOOGLE_PROJECT_ID") ?? projectFromServiceAccount(sa);
  const refresh = env("GOOGLE_OAUTH_REFRESH_TOKEN");
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");

  const mode: GoogleAuthMode = sa
    ? "service-account"
    : refresh && clientId && clientSecret
      ? "refresh-token"
      : "none";

  // The reason is assembled from what is ABSENT, so an operator reading a log
  // knows the next step rather than that "auth failed".
  const missing: string[] = [];
  if (!projectId) missing.push("GOOGLE_CLOUD_PROJECT");
  if (mode === "none") {
    if (refresh || clientId || clientSecret) {
      // A half-configured OAuth setup is worth calling out separately: it
      // looks provisioned and is not.
      if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
      if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
      if (!refresh) missing.push("GOOGLE_OAUTH_REFRESH_TOKEN");
    } else {
      // Named in the order of least work for the owner: the Firebase key
      // already exists and needs only a flag.
      missing.push(
        "GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_VERTEX_USE_FIREBASE_SA=true to " +
          "reuse FIREBASE_SERVICE_ACCOUNT, or the GOOGLE_OAUTH_* trio",
      );
    }
  }
  return {
    mode,
    projectId,
    ready: mode !== "none" && Boolean(projectId),
    reason: missing.length ? `missing: ${missing.join(", ")}` : null,
  };
}

/* ---------------------------------------------------------------- caching --
 * An access token lasts about an hour. Minting one per request would add a
 * round trip to every call and, on the service-account path, an RSA signature
 * as well. Cached in module scope, which in a Deno edge function survives for
 * the life of the isolate and no longer — the right lifetime for a
 * short-lived credential, and nothing is written anywhere durable.
 * -------------------------------------------------------------------------- */
let cached: { token: string; expiresAtMs: number } | null = null;

/** Sixty seconds of slack, so a token cannot expire mid-flight. */
const SKEW_MS = 60_000;

/** For tests: forget any cached token. */
export function resetGoogleTokenCache() {
  cached = null;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * A PEM private key, as the bytes WebCrypto wants.
 *
 * The return type is pinned to `Uint8Array<ArrayBuffer>` rather than left bare:
 * a bare `Uint8Array` widens to `ArrayBufferLike`, which includes
 * SharedArrayBuffer, and `crypto.subtle.importKey` will not take one.
 */
function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The signed assertion a service account exchanges for a token.
 *
 * Exported so its SHAPE can be tested without a private key: the claim set is
 * where a wrong `aud` or a missing `scope` produces an opaque
 * `invalid_grant`, which is among the least helpful errors Google returns.
 */
export function serviceAccountClaims(clientEmail: string, nowSec: number) {
  return {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    // One hour is Google's maximum for this assertion; longer is rejected.
    exp: nowSec + 3600,
  };
}

async function signServiceAccountJwt(sa: { client_email: string; private_key: string }) {
  const header = { alg: "RS256", typ: "JWT" };
  const nowSec = Math.floor(Date.now() / 1000);
  const unsigned =
    `${base64url(enc(JSON.stringify(header)))}.` +
    `${base64url(enc(JSON.stringify(serviceAccountClaims(sa.client_email, nowSec))))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc(unsigned)));
  return `${unsigned}.${base64url(sig)}`;
}

export type TokenResult =
  | { ok: true; token: string; mode: GoogleAuthMode; projectId: string }
  | { ok: false; reason: string };

/**
 * An access token, minted or reused.
 *
 * Returns a REASON rather than throwing, because every caller here is inside a
 * spend guard that has to decide whether a charge happened — and a thrown
 * error there is indistinguishable from a provider failure.
 */
export async function googleAccessToken(
  env: (k: string) => string | undefined = (k) =>
    typeof Deno === "undefined" ? undefined : Deno.env.get(k),
): Promise<TokenResult> {
  const status = googleAuthStatus(env);
  if (!status.ready || !status.projectId) {
    return { ok: false, reason: status.reason ?? "google auth not configured" };
  }
  if (cached && cached.expiresAtMs - SKEW_MS > Date.now()) {
    return { ok: true, token: cached.token, mode: status.mode, projectId: status.projectId };
  }

  let body: string;
  if (status.mode === "service-account") {
    let sa: { client_email?: string; private_key?: string };
    try {
      sa = JSON.parse(serviceAccountJson(env)!);
    } catch {
      // The commonest real failure: a JSON key pasted into a secret with its
      // newlines mangled. Say which secret, never what is in it.
      return { ok: false, reason: "the service-account secret is not valid JSON" };
    }
    if (!sa.client_email || !sa.private_key) {
      return { ok: false, reason: "the service-account secret lacks client_email or private_key" };
    }
    let assertion: string;
    try {
      assertion = await signServiceAccountJwt({
        client_email: sa.client_email,
        private_key: sa.private_key,
      });
    } catch {
      return { ok: false, reason: "the service-account private_key could not be read" };
    }
    body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString();
  } else {
    body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN")!,
    }).toString();
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, reason: "could not reach Google's token endpoint" };
  }
  const parsed = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
    error_description?: unknown;
  } | null;
  if (!res.ok || typeof parsed?.access_token !== "string") {
    // Google's own words. `invalid_grant` usually means a revoked or expired
    // refresh token, and that is worth being able to read in a log.
    const err =
      typeof parsed?.error_description === "string"
        ? parsed.error_description
        : typeof parsed?.error === "string"
          ? parsed.error
          : `http ${res.status}`;
    return { ok: false, reason: `token exchange failed: ${err}` };
  }
  const ttl = typeof parsed.expires_in === "number" ? parsed.expires_in : 3600;
  cached = { token: parsed.access_token, expiresAtMs: Date.now() + ttl * 1000 };
  return { ok: true, token: parsed.access_token, mode: status.mode, projectId: status.projectId };
}

/** The headers Vertex wants. The project header is not optional there. */
export function vertexHeaders(token: string, projectId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-goog-user-project": projectId,
    "content-type": "application/json",
  };
}
