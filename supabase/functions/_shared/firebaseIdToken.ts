/**
 * Verifying a Firebase ID token, properly.
 *
 * Owner directive 2026-09-05 (final): Firebase sends the phone OTP and proves
 * possession of the number; Supabase stays ONIQ's identity. This module is the
 * hinge. A caller hands the server a Firebase ID token and asks for a Supabase
 * session in exchange, so everything downstream trusts whatever this says.
 *
 * A DECODED JWT IS NOT A VERIFIED ONE. Splitting on "." and reading the payload
 * is what an attacker wants: the token is attacker-supplied, so an unverified
 * `phone_number` is simply a phone number they typed. The signature check is
 * the whole security of the endpoint, and it is why this module exists rather
 * than three lines inline.
 *
 * SPLIT PURE FROM NETWORKED, deliberately. `checkFirebaseClaims` is where the
 * dangerous mistakes live — a forgotten `aud`, an expiry compared the wrong
 * way — and it is pure, so it is exhaustively unit-tested with no network and
 * no key material. `verifyFirebaseIdToken` adds the signature and takes its
 * JWKS through an injectable fetcher for the same reason.
 */

/** Google's public keys for Firebase ID tokens, in JWK form (not the x509 set). */
export const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/**
 * Tolerance for clock skew between Google and this server, in seconds.
 *
 * Applied ONLY to claims that must be in the past (`iat`, `auth_time`). It is
 * deliberately NOT applied to `exp`: widening expiry extends the life of a
 * token that Google has already retired, which is the one direction where
 * being generous costs security rather than buying reliability.
 */
export const CLOCK_SKEW_SEC = 60;

export type FirebaseIdClaims = {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time?: number;
  phone_number?: string;
  email?: string;
  firebase?: { sign_in_provider?: string };
};

export type ClaimResult = { ok: true; claims: FirebaseIdClaims } | { ok: false; reason: string };

/** base64url -> bytes, without pulling in a dependency. */
export function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The three segments, or null. Shape only — this asserts nothing about trust. */
export function splitJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signed: string;
  sig: Uint8Array;
} | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;
  try {
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(b64uToBytes(parts[0])));
    const payload = JSON.parse(dec.decode(b64uToBytes(parts[1])));
    if (!header || typeof header !== "object" || !payload || typeof payload !== "object")
      return null;
    return { header, payload, signed: `${parts[0]}.${parts[1]}`, sig: b64uToBytes(parts[2]) };
  } catch {
    return null;
  }
}

/**
 * Every claim check Google's own verification requires, plus two of ONIQ's.
 *
 * PURE, and ordered so the reason returned names the first thing actually
 * wrong. Each `reason` is for the SERVER LOG — callers get one flat refusal,
 * because telling an unauthenticated caller which check they failed is telling
 * them how to pass it.
 */
export function checkFirebaseClaims(
  payload: Record<string, unknown>,
  projectId: string,
  nowSec: number,
): ClaimResult {
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const num = (k: string) => (typeof payload[k] === "number" ? (payload[k] as number) : NaN);

  if (str("iss") !== `https://securetoken.google.com/${projectId}`)
    return { ok: false, reason: "bad iss" };
  // `aud` is the project id for Firebase ID tokens. Skipping it is what lets a
  // token minted by ANY other Firebase project through — and Google signs every
  // project's tokens with the same key set, so the signature alone would pass.
  if (str("aud") !== projectId) return { ok: false, reason: "bad aud" };

  const exp = num("exp");
  const iat = num("iat");
  if (!Number.isFinite(exp) || exp <= nowSec) return { ok: false, reason: "expired" };
  if (!Number.isFinite(iat) || iat > nowSec + CLOCK_SKEW_SEC)
    return { ok: false, reason: "issued in the future" };

  const authTime = num("auth_time");
  if (Number.isFinite(authTime) && authTime > nowSec + CLOCK_SKEW_SEC) {
    return { ok: false, reason: "auth_time in the future" };
  }

  const sub = str("sub");
  if (!sub || sub.length > 128) return { ok: false, reason: "bad sub" };

  // ONIQ'S OWN TWO, and the second is not paranoia.
  //
  // Email/Password self-signup is OPEN on this project to anyone holding the
  // public web API key (measured 2026-09-05), so an attacker can mint a
  // perfectly valid, correctly signed ID token for an account they just made.
  // What they CANNOT do is make it say it came from the phone provider with a
  // verified number attached. Requiring both is what keeps this endpoint a
  // phone-possession proof rather than a "signed in somehow" proof.
  const provider =
    typeof (payload.firebase as { sign_in_provider?: unknown } | undefined)?.sign_in_provider ===
    "string"
      ? (payload.firebase as { sign_in_provider: string }).sign_in_provider
      : "";
  if (provider !== "phone")
    return { ok: false, reason: `sign_in_provider ${provider || "missing"}` };

  const phone = str("phone_number");
  if (!/^\+[1-9]\d{6,17}$/.test(phone)) return { ok: false, reason: "no usable phone_number" };

  return {
    ok: true,
    claims: {
      sub,
      aud: str("aud"),
      iss: str("iss"),
      exp,
      iat,
      ...(Number.isFinite(authTime) ? { auth_time: authTime } : {}),
      phone_number: phone,
      firebase: { sign_in_provider: provider },
    },
  };
}

type Jwk = { kid?: string; kty?: string; alg?: string; n?: string; e?: string };

/** Pick the key the token names, refusing anything not RS256/RSA. */
export function selectJwk(keys: Jwk[], kid: unknown, alg: unknown): Jwk | null {
  if (alg !== "RS256") return null;
  if (typeof kid !== "string" || !kid) return null;
  const k = keys.find((x) => x?.kid === kid);
  if (!k || k.kty !== "RSA" || (k.alg && k.alg !== "RS256")) return null;
  return k;
}

/**
 * Full verification: shape, signature, then claims.
 *
 * `fetchJwks` is injected so tests can drive it without network, and so a
 * caller can cache. It is called at most twice: once, and again only when the
 * token names a `kid` the cached set does not carry, which is what a key
 * rotation looks like from here.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  fetchJwks: (force: boolean) => Promise<Jwk[]>,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<ClaimResult> {
  const parts = splitJwt(token);
  if (!parts) return { ok: false, reason: "not a jwt" };

  let keys = await fetchJwks(false);
  let jwk = selectJwk(keys, parts.header.kid, parts.header.alg);
  if (!jwk) {
    keys = await fetchJwks(true);
    jwk = selectJwk(keys, parts.header.kid, parts.header.alg);
  }
  if (!jwk) return { ok: false, reason: "no matching signing key" };

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      parts.sig as unknown as ArrayBuffer,
      new TextEncoder().encode(parts.signed) as unknown as ArrayBuffer,
    );
  } catch {
    return { ok: false, reason: "signature check threw" };
  }
  // The claims are read ONLY after the signature holds. Checking them first
  // would mean reasoning about attacker-controlled values and is how a
  // "verified" function ends up trusting an unsigned token on some branch.
  if (!verified) return { ok: false, reason: "bad signature" };

  return checkFirebaseClaims(parts.payload, projectId, nowSec);
}
