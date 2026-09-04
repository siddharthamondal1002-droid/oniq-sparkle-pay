/**
 * THE CREDENTIAL VOICE REPLICATION NEEDS, and the guard around whose money it
 * spends.
 *
 * Vertex AI refuses the API key ONIQ holds — measured 2026-09-04, three ways,
 * all 401 CREDENTIALS_MISSING before any project check — so a real OAuth2
 * token has to be minted. Two things are worth testing hard about that:
 *
 *   1. THE OPT-IN. A Google Cloud service account already sits in this
 *      project's secrets as FIREBASE_SERVICE_ACCOUNT. Using it silently would
 *      put Vertex spend on that project's billing account, which CLAUDE.md
 *      says is the owner's decision. So the tests below assert that it is NOT
 *      picked up until somebody sets the flag.
 *   2. THE SIGNATURE. The service-account path hand-rolls RS256 over a PEM
 *      key, and a wrong claim there surfaces as `invalid_grant` — among the
 *      least informative errors Google returns. A real keypair is generated
 *      here and the produced assertion is verified against it, so a broken
 *      PEM reader or base64url fails at build time rather than in a log.
 *
 * No test here reaches Google. `fetch` is replaced and handed back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  googleAccessToken,
  googleAuthStatus,
  resetGoogleTokenCache,
  serviceAccountClaims,
  vertexHeaders,
} from "../../../supabase/functions/_shared/googleAuth.ts";

/** An env accessor over a plain object — the shape every function here takes. */
const envOf =
  (vars: Record<string, string>) =>
  (k: string): string | undefined =>
    vars[k];

/** A service-account key's JSON, minus the private key, which most tests skip. */
const saJson = (projectId = "oniq-vertex", extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "service_account",
    project_id: projectId,
    client_email: "vertex@oniq-vertex.iam.gserviceaccount.com",
    ...extra,
  });

describe("googleAuthStatus — which credential the environment holds", () => {
  it("reports none, and no project, when nothing is configured", () => {
    const s = googleAuthStatus(envOf({}));
    expect(s.mode).toBe("none");
    expect(s.projectId).toBeNull();
    expect(s.ready).toBe(false);
  });

  it("names all three routes when none of them is configured", () => {
    // An operator reading this in a log should know the next step, not merely
    // that authentication failed.
    const reason = googleAuthStatus(envOf({})).reason ?? "";
    expect(reason).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(reason).toContain("GOOGLE_VERTEX_USE_FIREBASE_SA");
    expect(reason).toContain("GOOGLE_OAUTH");
    expect(reason).toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("takes a dedicated service account, and the project inside it", () => {
    const s = googleAuthStatus(envOf({ GOOGLE_SERVICE_ACCOUNT_JSON: saJson() }));
    expect(s.mode).toBe("service-account");
    expect(s.projectId).toBe("oniq-vertex");
    expect(s.ready).toBe(true);
    expect(s.reason).toBeNull();
  });

  // ------------------------------------------------- the owner's-money guard
  it("does NOT use FIREBASE_SERVICE_ACCOUNT merely because it exists", () => {
    // THE POINT OF THIS FILE. That secret is already provisioned. Reaching for
    // it unasked would route Vertex charges onto the Firebase project's
    // billing account — a payment decision made by inference, which is the
    // exact failure CLAUDE.md's first rule was written after.
    const s = googleAuthStatus(envOf({ FIREBASE_SERVICE_ACCOUNT: saJson("oniq-firebase") }));
    expect(s.mode).toBe("none");
    expect(s.projectId).toBeNull();
    expect(s.ready).toBe(false);
  });

  it("uses it once the owner sets the flag, whatever the casing", () => {
    for (const flag of ["true", "TRUE", "True"]) {
      const s = googleAuthStatus(
        envOf({
          FIREBASE_SERVICE_ACCOUNT: saJson("oniq-firebase"),
          GOOGLE_VERTEX_USE_FIREBASE_SA: flag,
        }),
      );
      expect(s.mode, flag).toBe("service-account");
      expect(s.projectId, flag).toBe("oniq-firebase");
    }
  });

  it("treats anything that is not true as not opted in", () => {
    // "1" and "yes" look like consent and are not the documented value. A
    // near-miss must fail CLOSED, because the thing being consented to is
    // spending money.
    for (const flag of ["1", "yes", "on", "false", "", " true"]) {
      const s = googleAuthStatus(
        envOf({
          FIREBASE_SERVICE_ACCOUNT: saJson("oniq-firebase"),
          GOOGLE_VERTEX_USE_FIREBASE_SA: flag,
        }),
      );
      expect(s.mode, JSON.stringify(flag)).toBe("none");
    }
  });

  it("prefers a dedicated key over the Firebase one even when opted in", () => {
    const s = googleAuthStatus(
      envOf({
        GOOGLE_SERVICE_ACCOUNT_JSON: saJson("oniq-vertex"),
        FIREBASE_SERVICE_ACCOUNT: saJson("oniq-firebase"),
        GOOGLE_VERTEX_USE_FIREBASE_SA: "true",
      }),
    );
    expect(s.projectId).toBe("oniq-vertex");
  });

  // ------------------------------------------------------------- the project
  it("lets an explicit project override the one inside the key", () => {
    const s = googleAuthStatus(
      envOf({
        GOOGLE_SERVICE_ACCOUNT_JSON: saJson("in-the-key"),
        GOOGLE_CLOUD_PROJECT: "explicit",
      }),
    );
    expect(s.projectId).toBe("explicit");
  });

  it("accepts GOOGLE_PROJECT_ID as the second spelling", () => {
    expect(googleAuthStatus(envOf({ GOOGLE_PROJECT_ID: "second-spelling" })).projectId).toBe(
      "second-spelling",
    );
  });

  it("finds no project in a key that is not JSON, and says so", () => {
    // A JSON key pasted with mangled newlines is the commonest real failure.
    // Mode is still service-account — a credential IS configured — but there
    // is no project, so it is not ready.
    const s = googleAuthStatus(envOf({ GOOGLE_SERVICE_ACCOUNT_JSON: "{not json at all" }));
    expect(s.mode).toBe("service-account");
    expect(s.projectId).toBeNull();
    expect(s.ready).toBe(false);
    expect(s.reason).toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("finds no project in a key whose project_id is absent or empty", () => {
    for (const key of [JSON.stringify({ type: "service_account" }), saJson("")]) {
      expect(googleAuthStatus(envOf({ GOOGLE_SERVICE_ACCOUNT_JSON: key })).projectId).toBeNull();
    }
  });

  // -------------------------------------------------------- the OAuth3 route
  it("takes a refresh token only when all three parts are present", () => {
    const s = googleAuthStatus(
      envOf({
        GOOGLE_OAUTH_REFRESH_TOKEN: "refresh",
        GOOGLE_OAUTH_CLIENT_ID: "client",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
        GOOGLE_CLOUD_PROJECT: "oniq-vertex",
      }),
    );
    expect(s.mode).toBe("refresh-token");
    expect(s.ready).toBe(true);
    expect(s.reason).toBeNull();
  });

  it("names the missing part of a half-configured OAuth setup", () => {
    // Half configured looks provisioned and is not — worth calling out
    // precisely rather than falling back to the generic three-route message.
    const s = googleAuthStatus(
      envOf({ GOOGLE_OAUTH_REFRESH_TOKEN: "refresh", GOOGLE_CLOUD_PROJECT: "p" }),
    );
    expect(s.mode).toBe("none");
    expect(s.reason).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(s.reason).toContain("GOOGLE_OAUTH_CLIENT_SECRET");
    expect(s.reason).not.toContain("GOOGLE_OAUTH_REFRESH_TOKEN");
    expect(s.reason).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("has no project of its own on the OAuth route", () => {
    // A service-account key carries its project; a refresh token does not.
    const s = googleAuthStatus(
      envOf({
        GOOGLE_OAUTH_REFRESH_TOKEN: "refresh",
        GOOGLE_OAUTH_CLIENT_ID: "client",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      }),
    );
    expect(s.mode).toBe("refresh-token");
    expect(s.ready).toBe(false);
    expect(s.reason).toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("never puts a secret value in the reason", () => {
    // The reason is written to logs. It names what is MISSING, which is
    // operator information; a value never is.
    const s = googleAuthStatus(
      envOf({ GOOGLE_OAUTH_REFRESH_TOKEN: "sekret-refresh-value-9f3a", GOOGLE_CLOUD_PROJECT: "p" }),
    );
    expect(s.reason ?? "").not.toContain("sekret-refresh-value-9f3a");
  });
});

describe("serviceAccountClaims — the assertion Google will or will not accept", () => {
  const claims = serviceAccountClaims("vertex@oniq-vertex.iam.gserviceaccount.com", 1_757_000_000);

  it("is issued by the service account itself", () => {
    expect(claims.iss).toBe("vertex@oniq-vertex.iam.gserviceaccount.com");
  });

  it("is addressed to the token endpoint", () => {
    // A wrong `aud` is rejected as `invalid_grant` with no further detail.
    expect(claims.aud).toMatch(/^https:\/\/oauth2\./);
    expect(claims.aud).toMatch(/\/token$/);
  });

  it("asks for the scope Vertex needs", () => {
    expect(claims.scope).toMatch(/\/auth\/cloud-platform$/);
  });

  it("lives exactly one hour, which is Google's maximum", () => {
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims.iat).toBe(1_757_000_000);
  });
});

/* ------------------------------------------------------------ minting a token
 * `fetch` is replaced for this block and handed back afterwards; the module
 * caches in its own scope, so the cache is cleared before every test.
 * ---------------------------------------------------------------------------- */
describe("googleAccessToken", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; body: string }[] = [];

  /** A stand-in token endpoint. `reply` decides what it answers. */
  function stubToken(reply: () => Response) {
    globalThis.fetch = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return reply();
    }) as unknown as typeof fetch;
  }

  const okBody = (token = "ya29.stub", expiresIn = 3600) =>
    new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });

  const oauthEnv = envOf({
    GOOGLE_OAUTH_REFRESH_TOKEN: "refresh-abc",
    GOOGLE_OAUTH_CLIENT_ID: "client-abc",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret-abc",
    GOOGLE_CLOUD_PROJECT: "oniq-vertex",
  });

  beforeEach(() => {
    calls = [];
    resetGoogleTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    resetGoogleTokenCache();
    vi.useRealTimers();
  });

  it("spends nothing when no credential is configured", () => {
    // The call must fail on the STATUS, before any network. A request that
    // goes out and then fails has still cost a round trip and a log line.
    stubToken(() => okBody());
    return googleAccessToken(envOf({})).then((r) => {
      expect(r.ok).toBe(false);
      expect(calls).toHaveLength(0);
    });
  });

  it("exchanges a refresh token for an access token", async () => {
    stubToken(() => okBody("ya29.from-refresh"));
    const r = await googleAccessToken(oauthEnv);
    expect(r).toEqual({
      ok: true,
      token: "ya29.from-refresh",
      mode: "refresh-token",
      projectId: "oniq-vertex",
    });
    const sent = new URLSearchParams(calls[0].body);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("refresh-abc");
    expect(sent.get("client_id")).toBe("client-abc");
    expect(sent.get("client_secret")).toBe("secret-abc");
  });

  it("reuses a live token rather than minting a second one", async () => {
    stubToken(() => okBody());
    await googleAccessToken(oauthEnv);
    const again = await googleAccessToken(oauthEnv);
    expect(again).toMatchObject({ ok: true, token: "ya29.stub" });
    expect(calls).toHaveLength(1);
  });

  it("re-mints a token that is about to expire", async () => {
    // A token with 30s left would expire mid-flight on a slow Vertex call.
    // The 60s skew is what stops that, so it is asserted rather than assumed.
    stubToken(() => okBody("ya29.short", 30));
    await googleAccessToken(oauthEnv);
    await googleAccessToken(oauthEnv);
    expect(calls).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    stubToken(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await googleAccessToken(oauthEnv);
    stubToken(() => okBody("ya29.second-try"));
    expect(await googleAccessToken(oauthEnv)).toMatchObject({ ok: true, token: "ya29.second-try" });
  });

  // ------------------------------------------------------------- what failed
  it("surfaces Google's own description of the failure", async () => {
    stubToken(
      () =>
        new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired" }),
          { status: 400 },
        ),
    );
    const r = await googleAccessToken(oauthEnv);
    expect(r).toEqual({ ok: false, reason: "token exchange failed: Token has been expired" });
  });

  it("falls back to the error code, then to the status", async () => {
    stubToken(() => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    expect(await googleAccessToken(oauthEnv)).toMatchObject({
      reason: "token exchange failed: invalid_client",
    });
    resetGoogleTokenCache();
    stubToken(() => new Response("<html>gateway</html>", { status: 502 }));
    expect(await googleAccessToken(oauthEnv)).toMatchObject({
      reason: "token exchange failed: http 502",
    });
  });

  it("returns a reason rather than throwing when the network is down", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const r = await googleAccessToken(oauthEnv);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("token endpoint") });
  });

  it("leaks no secret into a failure reason", async () => {
    stubToken(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const r = await googleAccessToken(oauthEnv);
    const reason = r.ok ? "" : r.reason;
    for (const secret of ["refresh-abc", "client-abc", "secret-abc"]) {
      expect(reason, secret).not.toContain(secret);
    }
  });

  // ------------------------------------------------- the service-account path
  it("says which secret is unreadable when the key is not JSON", async () => {
    stubToken(() => okBody());
    const r = await googleAccessToken(
      envOf({ GOOGLE_SERVICE_ACCOUNT_JSON: "{mangled", GOOGLE_CLOUD_PROJECT: "p" }),
    );
    expect(r).toEqual({ ok: false, reason: "the service-account secret is not valid JSON" });
    expect(calls).toHaveLength(0);
  });

  it("says what a key is missing rather than failing at Google", async () => {
    stubToken(() => okBody());
    const r = await googleAccessToken(envOf({ GOOGLE_SERVICE_ACCOUNT_JSON: saJson() }));
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("private_key") });
    expect(calls).toHaveLength(0);
  });

  it("says the private key could not be read rather than crashing on it", async () => {
    stubToken(() => okBody());
    const r = await googleAccessToken(
      envOf({
        GOOGLE_SERVICE_ACCOUNT_JSON: saJson("p", {
          private_key: "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----\n",
        }),
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("private_key") });
    expect(calls).toHaveLength(0);
  });

  it("signs an assertion Google could actually verify", async () => {
    // The whole service-account path in one test: a REAL keypair is generated,
    // the PEM is written the way a service-account JSON writes it, and the
    // assertion this module produces is verified against the public half. A
    // broken PEM reader or a mangled base64url fails here instead of arriving
    // as `invalid_grant` with nothing else to go on.
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const b64 = btoa(String.fromCharCode(...pkcs8));
    const pem = `-----BEGIN PRIVATE KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;

    stubToken(() => okBody("ya29.from-service-account"));
    const r = await googleAccessToken(
      envOf({
        GOOGLE_SERVICE_ACCOUNT_JSON: saJson("oniq-vertex", { private_key: pem }),
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      token: "ya29.from-service-account",
      mode: "service-account",
    });

    const sent = new URLSearchParams(calls[0].body);
    expect(sent.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = sent.get("assertion") ?? "";
    const [h, p, s] = assertion.split(".");
    expect(h && p && s).toBeTruthy();

    const unb64 = (v: string) =>
      atob(
        v
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .padEnd(Math.ceil(v.length / 4) * 4, "="),
      );
    expect(JSON.parse(unb64(h))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(unb64(p));
    expect(claims.iss).toBe("vertex@oniq-vertex.iam.gserviceaccount.com");
    expect(claims.exp - claims.iat).toBe(3600);

    const sigChars = unb64(s);
    const sig = new Uint8Array(sigChars.length);
    for (let i = 0; i < sigChars.length; i++) sig[i] = sigChars.charCodeAt(i);
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(verified).toBe(true);
  });
});

describe("vertexHeaders", () => {
  it("carries the bearer token and the project Vertex bills", () => {
    // `x-goog-user-project` is not optional on Vertex: without it the call is
    // authenticated as somebody with no project to charge.
    expect(vertexHeaders("ya29.stub", "oniq-vertex")).toEqual({
      authorization: "Bearer ya29.stub",
      "x-goog-user-project": "oniq-vertex",
      "content-type": "application/json",
    });
  });
});
