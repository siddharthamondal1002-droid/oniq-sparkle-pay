/**
 * The Firebase phone adapter, driven without Firebase.
 *
 * Everything outside the orchestration is injected, so these tests cover the
 * ordering rules that actually break sign-ins — verifying before sending,
 * re-verifying after a session is minted, a wrongly formatted number reaching
 * the SMS call — with no SDK, no DOM and no reCAPTCHA.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFirebasePhoneProviders,
  exchangeFirebaseIdToken,
  firebaseErrorDetail,
  isE164,
  type PhoneAuthSurface,
} from "../firebasePhoneOtp";
import { sendOtp, verifyOtpCode } from "../otpFlow";

const surfaceThatWorks = (idToken = "id-token"): PhoneAuthSurface => ({
  send: async () => ({ confirm: async () => idToken }),
});

const deps = (over: Partial<Parameters<typeof createFirebasePhoneProviders>[0]> = {}) => ({
  surface: surfaceThatWorks(),
  exchange: vi.fn(async () => "hash-1"),
  establish: vi.fn(async () => {}),
  ...over,
});

describe("E.164 is required, not assumed", () => {
  it("recognises the format Firebase needs", () => {
    expect(isE164("+919000000001")).toBe(true);
    expect(isE164("919000000001")).toBe(false);
    expect(isE164("+0119000000001")).toBe(false);
    expect(isE164("9000000001")).toBe(false);
  });

  it("refuses a non-E.164 number rather than normalising it", async () => {
    // Silently "fixing" the number is how an SMS reaches the wrong person and
    // nobody finds out. The MSG91 widget format is the realistic mistake here.
    const p = createFirebasePhoneProviders(deps());
    const res = await sendOtp(p, "91-9000000001");
    expect(res).toEqual({ ok: false, error: "phone number must be E.164" });
  });
});

describe("ordering", () => {
  it("refuses to verify before anything was sent", async () => {
    const p = createFirebasePhoneProviders(deps());
    // Surfaced through otpFlow, which maps a thrown verify to invalid_code —
    // so the assertion is that it FAILS, and that nothing was exchanged.
    const d = deps();
    const p2 = createFirebasePhoneProviders(d);
    const res = await verifyOtpCode(p2, "123456");
    expect(res.ok).toBe(false);
    expect(d.exchange).not.toHaveBeenCalled();
    expect(p).toBeTruthy();
  });

  it("runs send -> verify -> exchange -> establish, in that order", async () => {
    const order: string[] = [];
    const d = {
      surface: {
        send: async () => {
          order.push("send");
          return { confirm: async () => (order.push("confirm"), "tok") };
        },
      },
      exchange: async (t: string) => {
        order.push(`exchange:${t}`);
        return "hash-9";
      },
      establish: async (h: string) => {
        order.push(`establish:${h}`);
      },
    };
    const p = createFirebasePhoneProviders(d);
    expect(await sendOtp(p, "+919000000001")).toEqual({ ok: true });
    expect(await verifyOtpCode(p, "123456")).toEqual({ ok: true });
    expect(order).toEqual(["send", "confirm", "exchange:tok", "establish:hash-9"]);
  });

  it("spends the confirmation once, so a second verify cannot re-mint", async () => {
    const d = deps();
    const p = createFirebasePhoneProviders(d);
    await sendOtp(p, "+919000000001");
    expect(await verifyOtpCode(p, "123456")).toEqual({ ok: true });
    const second = await verifyOtpCode(p, "123456");
    expect(second.ok).toBe(false);
    expect(d.exchange).toHaveBeenCalledTimes(1);
  });

  it("does not establish a session when the server refuses the token", async () => {
    const d = deps({
      exchange: vi.fn(async () => {
        throw new Error("that sign-in could not be verified");
      }),
    });
    const p = createFirebasePhoneProviders(d);
    await sendOtp(p, "+919000000001");
    const res = await verifyOtpCode(p, "123456");
    expect(res.ok).toBe(false);
    expect(d.establish).not.toHaveBeenCalled();
  });
});

describe("exchangeFirebaseIdToken", () => {
  const url = "https://project.supabase.co";

  it("returns the token_hash on success", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ verified: true, token_hash: "h" }), { status: 200 }),
    );
    await expect(
      exchangeFirebaseIdToken(url, "anon", "tok", f as unknown as typeof fetch),
    ).resolves.toBe("h");
  });

  it("throws the server's message on a refusal", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "that sign-in could not be verified" }), {
          status: 401,
        }),
    );
    await expect(
      exchangeFirebaseIdToken(url, "anon", "tok", f as unknown as typeof fetch),
    ).rejects.toThrow("that sign-in could not be verified");
  });

  it("throws on a 200 that carries no token_hash", async () => {
    // A truthy status is not a session. Returning undefined here would hand
    // `establish` an empty hash and fail somewhere far less obvious.
    const f = vi.fn(async () => new Response(JSON.stringify({ verified: true }), { status: 200 }));
    await expect(
      exchangeFirebaseIdToken(url, "anon", "tok", f as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it("survives a non-JSON body", async () => {
    const f = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    await expect(
      exchangeFirebaseIdToken(url, "anon", "tok", f as unknown as typeof fetch),
    ).rejects.toThrow();
  });
});

describe("the SDK import must survive the build", () => {
  // Regression guard for a defect this file already shipped once in draft.
  // `import(SOME_VARIABLE)` with `@vite-ignore` compiles fine and then leaves
  // the SDK out of the bundle entirely, so sign-in fails at runtime with a
  // bare specifier the browser cannot resolve. Nothing in a typecheck or a
  // unit test catches that — only reading the import form does.
  const SRC = readFileSync(join(process.cwd(), "src/lib/firebasePhoneOtp.ts"), "utf8");

  it("imports firebase by literal specifier, so Vite can bundle it", () => {
    expect(SRC).toContain('import("firebase/app")');
    expect(SRC).toContain('import("firebase/auth")');
  });

  it("never tells Vite to skip analysing a firebase import", () => {
    const code = SRC.replace(/\/\*\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(code).not.toContain("@vite-ignore");
  });

  it("keeps the import dynamic, so the SDK is not in the entry chunk", () => {
    // Static `import ... from "firebase/..."` would pull ~hundreds of KB into
    // the bundle every session, for a path most sessions never take.
    expect(SRC).not.toMatch(/^import\s[^\n]*from\s+["']firebase\//m);
  });
});

describe("firebaseErrorDetail — what the next failure has to tell us", () => {
  /**
   * MEASURED 2026-09-06 on a real handset: the whole diagnostic was the string
   * "Firebase: Error (auth/internal-error)." That code is the SDK's catch-all
   * for an unexpected Identity Toolkit response, so it is compatible with a
   * blocked API key, App Check enforcement, an unsolved reCAPTCHA and a Google
   * outage — four faults, three different owners, one message. The real text
   * is on customData.serverResponse, and these tests exist so it survives.
   */
  it("appends the Identity Toolkit message hiding on customData", () => {
    const err = {
      code: "auth/internal-error",
      message: "Firebase: Error (auth/internal-error).",
      customData: { serverResponse: { error: { message: "API_KEY_HTTP_REFERRER_BLOCKED" } } },
    };
    expect(firebaseErrorDetail(err)).toBe(
      "Firebase: Error (auth/internal-error). [API_KEY_HTTP_REFERRER_BLOCKED]",
    );
  });

  it("reads the underscore-prefixed field too", () => {
    // The SDK has shipped both spellings; pinning only one is how a diagnostic
    // silently reverts to useless after a dependency bump.
    const err = {
      message: "Firebase: Error (auth/internal-error).",
      customData: { _serverResponse: { error: { message: "APP_CHECK_TOKEN_INVALID" } } },
    };
    expect(firebaseErrorDetail(err)).toContain("APP_CHECK_TOKEN_INVALID");
  });

  it("says NO-SERVER-RESPONSE when Google never rejected anything", () => {
    // THIS TEST IS THE FIX FOR A BUG IN ITS OWN PREDECESSOR. The first version
    // asserted that the code is appended only when the message does not
    // already contain it — which reads sensibly and is useless, because
    // Firebase formats EVERY message as "Firebase: Error (<code>)." So the
    // guard was always true, the fallback never fired, and on a real handset
    // the "unwrapped" toast came back byte-identical to the raw one. A test
    // that blesses a diagnostic which cannot fire is worse than no test.
    //
    // The absence of a server response is a real finding: it means the call
    // never reached Google, so the fault is in the browser, not the project.
    const out = firebaseErrorDetail({
      code: "auth/internal-error",
      message: "Firebase: Error (auth/internal-error).",
    });
    expect(out).toContain("no-server-response");
    expect(out).not.toBe("Firebase: Error (auth/internal-error).");
  });

  it("dumps whatever other properties the error carries", () => {
    const out = firebaseErrorDetail({
      code: "auth/internal-error",
      message: "Firebase: Error (auth/internal-error).",
      customData: { appName: "[DEFAULT]" },
    });
    expect(out).toContain("appName");
  });

  it("keeps a whole unrecognised object rather than dropping it", () => {
    const err = { message: "x", customData: { serverResponse: { weird: 1 } } };
    expect(firebaseErrorDetail(err)).toBe('x [{"weird":1}]');
  });

  it("is total — never throws, whatever it is handed", () => {
    for (const bad of [null, undefined, "", 0, [], new Error("plain"), { code: 5 }]) {
      expect(() => firebaseErrorDetail(bad)).not.toThrow();
    }
    // A plain Error genuinely has no server response, so it is labelled as
    // one. Slightly noisy, and the noise is the honest reading: nothing came
    // back from Google because nothing was asked of Google.
    expect(firebaseErrorDetail(new Error("plain"))).toBe("plain [no-server-response]");
    // Nullish becomes "unknown error", not the string "null" — a toast reading
    // "null" tells the person in front of it strictly less than nothing.
    expect(firebaseErrorDetail(null)).toContain("unknown error");
    expect(firebaseErrorDetail(undefined)).toContain("unknown error");
  });
});
