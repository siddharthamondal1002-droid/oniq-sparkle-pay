// Integration-style tests for the OTP sign-up / sign-in flow: success and
// failure paths, with the provider and session layers stubbed.
import { describe, it, expect, vi } from "vitest";
import { sendOtp, verifyOtpCode, type OtpProviders } from "../otpFlow";

function providers(overrides: Partial<OtpProviders> = {}): OtpProviders {
  return {
    send: vi.fn(async () => {}),
    verify: vi.fn(async () => "provider-access-token-1234567890"),
    createSession: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("sendOtp", () => {
  it("succeeds when the provider accepts", async () => {
    const p = providers();
    const res = await sendOtp(p, "919876543210");
    expect(res.ok).toBe(true);
    expect(p.send).toHaveBeenCalledWith("919876543210");
  });

  it("returns the provider error on failure (e.g. rate limited)", async () => {
    const p = providers({
      send: vi.fn(async () => {
        throw new Error("rate limit exceeded");
      }),
    });
    const res = await sendOtp(p, "919876543210");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("rate limit");
  });
});

describe("verifyOtpCode — sign-in success path", () => {
  it("verifies the code, mints a session, and reports ok", async () => {
    const p = providers();
    const res = await verifyOtpCode(p, "123456");
    expect(res.ok).toBe(true);
    expect(p.verify).toHaveBeenCalledWith("123456");
    expect(p.createSession).toHaveBeenCalledWith("provider-access-token-1234567890");
  });
});

describe("verifyOtpCode — failure paths", () => {
  it("rejects malformed codes before touching the provider", async () => {
    const p = providers();
    const res = await verifyOtpCode(p, "12ab");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_code");
    expect(p.verify).not.toHaveBeenCalled();
  });

  it("maps a wrong code to invalid_code and never creates a session", async () => {
    const p = providers({
      verify: vi.fn(async () => {
        throw new Error("otp mismatch");
      }),
    });
    const res = await verifyOtpCode(p, "000000");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_code");
    expect(p.createSession).not.toHaveBeenCalled();
  });

  it("maps an expired code to expired", async () => {
    const p = providers({
      verify: vi.fn(async () => {
        throw new Error("OTP expired");
      }),
    });
    const res = await verifyOtpCode(p, "000000");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("expired");
  });

  it("surfaces server-side session failure (token rejected) as service error", async () => {
    const p = providers({
      createSession: vi.fn(async () => {
        throw new Error("invalid or expired code");
      }),
    });
    const res = await verifyOtpCode(p, "123456");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("service");
  });

  it("maps network failures during session creation to network", async () => {
    const p = providers({
      createSession: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    const res = await verifyOtpCode(p, "123456");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("network");
  });
});
