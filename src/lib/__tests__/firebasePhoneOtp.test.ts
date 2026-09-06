/**
 * The Firebase phone adapter, driven without Firebase.
 *
 * Everything outside the orchestration is injected, so these tests cover the
 * ordering rules that actually break sign-ins — verifying before sending,
 * re-verifying after a session is minted, a wrongly formatted number reaching
 * the SMS call — with no SDK, no DOM and no reCAPTCHA.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createFirebasePhoneProviders,
  exchangeFirebaseIdToken,
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
