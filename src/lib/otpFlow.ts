// OTP send/verify orchestration with injectable providers, so the flow is
// testable without a browser, an SMS or a network. The production adapter is
// `firebasePhoneOtp.ts`: Firebase sends the code and proves possession of the
// number, and the token it returns is ALWAYS verified server-side
// (firebase-phone-session, against Google's published signing keys) before a
// Supabase session is minted — the client never decides validity.
//
// The providers are injectable because the provider CHANGED. This flow was
// written against MSG91's browser widget, which was deleted on 2026-09-06
// without ever having delivered a code in production; every test below kept
// passing, because not one of them ever knew who the provider was.

import { isValidOtp } from "./phoneAuth";

export type OtpSendResult = { ok: true } | { ok: false; error: string };
export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; error: string; code: "invalid_code" | "expired" | "service" | "network" };

export type OtpProviders = {
  /** Ask the provider to send an OTP to an E.164 number. */
  send: (phone: string) => Promise<void>;
  /** Exchange the user-entered code for a provider access token. */
  verify: (code: string) => Promise<string>;
  /** Server-side: validate token, mint a Supabase session. Throws on failure. */
  createSession: (accessToken: string) => Promise<void>;
};

export async function sendOtp(providers: OtpProviders, phone: string): Promise<OtpSendResult> {
  try {
    await providers.send(phone);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "couldn't send the code" };
  }
}

export async function verifyOtpCode(
  providers: OtpProviders,
  code: string,
): Promise<OtpVerifyResult> {
  if (!isValidOtp(code)) {
    return { ok: false, error: "the code should be 6 digits", code: "invalid_code" };
  }
  let token: string;
  try {
    token = await providers.verify(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("expire"))
      return { ok: false, error: "code expired — request a new one", code: "expired" };
    return { ok: false, error: "invalid code — try again", code: "invalid_code" };
  }
  try {
    await providers.createSession(token);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "verification failed";
    const lower = msg.toLowerCase();
    if (lower.includes("network") || lower.includes("fetch")) {
      return { ok: false, error: "network hiccup — try again", code: "network" };
    }
    return { ok: false, error: msg, code: "service" };
  }
}
