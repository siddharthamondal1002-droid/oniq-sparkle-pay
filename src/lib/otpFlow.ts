// OTP send/verify orchestration with injectable providers, so the flow is
// testable without the MSG91 browser widget or network. The production
// adapter (widgetProviders) drives MSG91's script; verification of the
// returned access token ALWAYS happens server-side (msg91-verify-session)
// before a Supabase session is minted — the client never decides validity.

import { isValidOtp } from "./phoneAuth";

export type OtpSendResult = { ok: true } | { ok: false; error: string };
export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; error: string; code: "invalid_code" | "expired" | "service" | "network" };

export type OtpProviders = {
  /** Ask the provider to send an OTP to a widget-format number. */
  send: (widgetPhone: string) => Promise<void>;
  /** Exchange the user-entered code for a provider access token. */
  verify: (code: string) => Promise<string>;
  /** Server-side: validate token, mint a Supabase session. Throws on failure. */
  createSession: (accessToken: string) => Promise<void>;
};

export async function sendOtp(
  providers: OtpProviders,
  widgetPhone: string,
): Promise<OtpSendResult> {
  try {
    await providers.send(widgetPhone);
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
