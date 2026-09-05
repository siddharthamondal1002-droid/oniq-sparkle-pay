/**
 * THE SIGNATURE IS THE ONLY THING PROTECTING THIS ENDPOINT.
 *
 * `firebase-phone-session` is unauthenticated by necessity — nobody is signed
 * in when they ask to sign in — and it hands back a real Supabase session in
 * exchange for a Firebase ID token. The token comes from the caller, so every
 * claim in it is attacker-supplied until the signature says otherwise. These
 * tests sign REAL tokens with a generated RSA key rather than stubbing the
 * crypto, because a verifier that is only tested against its own happy path
 * is a verifier nobody has tested.
 *
 * The claim checks are tested exhaustively for the same reason: each one is a
 * single line whose absence is invisible in review and total in effect.
 */
import { describe, expect, it, beforeAll } from "vitest";
import {
  CLOCK_SKEW_SEC,
  checkFirebaseClaims,
  selectJwk,
  splitJwt,
  verifyFirebaseIdToken,
} from "../../../supabase/functions/_shared/firebaseIdToken";

const PROJECT = "oniq-309bd";
const NOW = 1_780_000_000;

const b64u = (b: Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
  return Buffer.from(bytes).toString("base64url");
};

/** A claim set that passes everything, so each test can spoil exactly one thing. */
const goodPayload = (over: Record<string, unknown> = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`,
  aud: PROJECT,
  sub: "aVeryRealFirebaseUid",
  iat: NOW - 60,
  exp: NOW + 3600,
  auth_time: NOW - 60,
  phone_number: "+919000000001",
  firebase: { sign_in_provider: "phone" },
  ...over,
});

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid?: string; alg?: string };
let otherKeyPair: CryptoKeyPair;

beforeAll(async () => {
  const algo = {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  };
  keyPair = (await crypto.subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKeyPair = (await crypto.subtle.generateKey(algo, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid: "k1",
    alg: "RS256",
  };
});

/** Sign a real RS256 JWT, so the verifier does real work. */
async function signToken(
  payload: unknown,
  key: CryptoKey = keyPair.privateKey,
  kid = "k1",
  alg = "RS256",
) {
  const signed = `${b64u(JSON.stringify({ alg, kid, typ: "JWT" }))}.${b64u(JSON.stringify(payload))}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signed)),
  );
  return `${signed}.${b64u(sig)}`;
}

const jwks = async () => [publicJwk as never];

describe("claim checks — each one alone can let an attacker in", () => {
  it("accepts a well-formed phone token", () => {
    const r = checkFirebaseClaims(goodPayload(), PROJECT, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims.phone_number).toBe("+919000000001");
  });

  it("rejects a token minted for a DIFFERENT Firebase project", () => {
    // The one that matters most: Google signs every project's tokens with the
    // same key set, so the signature alone passes and only `aud` catches it.
    const r = checkFirebaseClaims(goodPayload({ aud: "someone-elses-app" }), PROJECT, NOW);
    expect(r).toEqual({ ok: false, reason: "bad aud" });
  });

  it("rejects a wrong issuer", () => {
    expect(
      checkFirebaseClaims(goodPayload({ iss: "https://evil.example/x" }), PROJECT, NOW),
    ).toEqual({
      ok: false,
      reason: "bad iss",
    });
  });

  it("rejects an expired token, with no grace", () => {
    expect(checkFirebaseClaims(goodPayload({ exp: NOW }), PROJECT, NOW).ok).toBe(false);
    expect(checkFirebaseClaims(goodPayload({ exp: NOW - 1 }), PROJECT, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
    // Skew is deliberately NOT applied to exp — that would extend the life of a
    // token Google has already retired.
    expect(
      checkFirebaseClaims(goodPayload({ exp: NOW - CLOCK_SKEW_SEC + 1 }), PROJECT, NOW).ok,
    ).toBe(false);
  });

  it("tolerates real clock skew on iat but not a token from the future", () => {
    expect(
      checkFirebaseClaims(goodPayload({ iat: NOW + CLOCK_SKEW_SEC - 1 }), PROJECT, NOW).ok,
    ).toBe(true);
    expect(
      checkFirebaseClaims(goodPayload({ iat: NOW + CLOCK_SKEW_SEC + 5 }), PROJECT, NOW),
    ).toEqual({
      ok: false,
      reason: "issued in the future",
    });
  });

  it("rejects a token that did not come from the PHONE provider", () => {
    // Email/Password self-signup is open on this project to anyone holding the
    // public web key, so a validly signed token is NOT proof of a phone.
    for (const p of ["password", "google.com", "anonymous", "custom"]) {
      const r = checkFirebaseClaims(
        goodPayload({ firebase: { sign_in_provider: p } }),
        PROJECT,
        NOW,
      );
      expect(r.ok, p).toBe(false);
    }
    expect(checkFirebaseClaims(goodPayload({ firebase: {} }), PROJECT, NOW).ok).toBe(false);
    expect(checkFirebaseClaims(goodPayload({ firebase: undefined }), PROJECT, NOW).ok).toBe(false);
  });

  it("requires a usable E.164 phone number", () => {
    for (const bad of ["", "9000000001", "+0123456789", "not a phone", "+9"]) {
      expect(checkFirebaseClaims(goodPayload({ phone_number: bad }), PROJECT, NOW).ok, bad).toBe(
        false,
      );
    }
  });

  it("requires a sane sub", () => {
    expect(checkFirebaseClaims(goodPayload({ sub: "" }), PROJECT, NOW).ok).toBe(false);
    expect(checkFirebaseClaims(goodPayload({ sub: "x".repeat(129) }), PROJECT, NOW).ok).toBe(false);
    expect(checkFirebaseClaims(goodPayload({ sub: "x".repeat(128) }), PROJECT, NOW).ok).toBe(true);
  });

  it("treats a missing or wrongly-typed claim as absent, not as zero", () => {
    expect(checkFirebaseClaims(goodPayload({ exp: "9999999999" }), PROJECT, NOW).ok).toBe(false);
    expect(checkFirebaseClaims(goodPayload({ aud: 12345 }), PROJECT, NOW).ok).toBe(false);
    expect(checkFirebaseClaims({}, PROJECT, NOW).ok).toBe(false);
  });
});

describe("key selection", () => {
  it("refuses anything but RS256 with a known kid", () => {
    const keys = [{ kid: "k1", kty: "RSA", alg: "RS256" }];
    expect(selectJwk(keys, "k1", "RS256")).toBeTruthy();
    expect(selectJwk(keys, "k1", "none")).toBeNull();
    expect(selectJwk(keys, "k1", "HS256")).toBeNull();
    expect(selectJwk(keys, "unknown", "RS256")).toBeNull();
    expect(selectJwk(keys, undefined, "RS256")).toBeNull();
    expect(selectJwk([{ kid: "k1", kty: "oct" }], "k1", "RS256")).toBeNull();
  });
});

describe("splitJwt is shape-only and never throws", () => {
  it("returns null for anything that is not three decodable segments", () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", "!!.??.$$", "a.b.c"]) {
      expect(splitJwt(bad), bad).toBeNull();
    }
  });
});

describe("full verification, against real signatures", () => {
  it("accepts a genuinely signed, well-formed token", async () => {
    const t = await signToken(goodPayload());
    const r = await verifyFirebaseIdToken(t, PROJECT, jwks, NOW);
    expect(r.ok).toBe(true);
  });

  it("rejects a token signed by a DIFFERENT key", async () => {
    const t = await signToken(goodPayload(), otherKeyPair.privateKey);
    expect(await verifyFirebaseIdToken(t, PROJECT, jwks, NOW)).toEqual({
      ok: false,
      reason: "bad signature",
    });
  });

  it("rejects a token whose payload was edited after signing", async () => {
    // The attack this whole module exists to stop: take a real token, swap the
    // phone number for someone else's, present it.
    const t = await signToken(goodPayload());
    const [h, , s] = t.split(".");
    const forged = `${h}.${b64u(JSON.stringify(goodPayload({ phone_number: "+919999999999" })))}.${s}`;
    expect(await verifyFirebaseIdToken(forged, PROJECT, jwks, NOW)).toEqual({
      ok: false,
      reason: "bad signature",
    });
  });

  it("checks the signature BEFORE the claims", async () => {
    // A token that is both unsigned-by-us AND has a bad aud must report the
    // signature. Reporting the claim would mean claims were read from a token
    // nothing had vouched for.
    const t = await signToken(goodPayload({ aud: "someone-else" }), otherKeyPair.privateKey);
    expect(await verifyFirebaseIdToken(t, PROJECT, jwks, NOW)).toEqual({
      ok: false,
      reason: "bad signature",
    });
  });

  it("refetches the key set once when the token names an unknown kid", async () => {
    const calls: boolean[] = [];
    const rotating = async (force: boolean) => {
      calls.push(force);
      return (force ? [publicJwk] : []) as never[];
    };
    const t = await signToken(goodPayload());
    const r = await verifyFirebaseIdToken(t, PROJECT, rotating, NOW);
    expect(calls).toEqual([false, true]);
    expect(r.ok).toBe(true);
  });

  it("gives up rather than guessing when no key matches", async () => {
    const t = await signToken(goodPayload(), keyPair.privateKey, "unknown-kid");
    expect(await verifyFirebaseIdToken(t, PROJECT, jwks, NOW)).toEqual({
      ok: false,
      reason: "no matching signing key",
    });
  });
});
