/**
 * The phone sign-in screen is wired to Firebase, and MSG91 is gone.
 *
 * Owner, 2026-09-06: "remove msg91 that path was never proven successful."
 * `OTP_LOGIN_ENABLED` had been false since the MSG91 credentials went missing,
 * so phone sign-in never rendered — which meant MSG91 was not a working
 * fallback to keep, it was a disabled path with a live server surface behind
 * it (four edge functions, one of them an account-existence oracle).
 *
 * TWO THINGS ARE PINNED HERE, AND ONLY TWO.
 *
 * FIRST, THE CONTAINER ID, because it is the one link in this flow that no
 * typecheck and no unit test can see. Firebase's `RecaptchaVerifier` takes the
 * id of a DOM node as a STRING and throws at runtime if nothing is there. The
 * screen passes `RECAPTCHA_CONTAINER_ID` to `firebasePhoneSurface` and renders
 * a div with the same constant; rename either one alone, or replace one with a
 * string literal, and phone sign-in breaks only for the person who taps the
 * button — in production, silently, long after the build went green.
 *
 * SECOND, THAT THE MSG91 SURFACE STAYS DELETED. Not as tidiness: an agent
 * asked to "fix phone login" against a half-removed path will reach for the
 * familiar `window.sendOTP` shape and rebuild it, and the deleted functions
 * included `check-user-exists`, which answers whether an ONIQ account exists
 * for a phone number or an email.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const AUTH = read("src/routes/auth.tsx");

describe("the reCAPTCHA container the verifier is constructed against", () => {
  it("is one constant, used both to render the node and to build the surface", () => {
    // Declared once...
    expect(AUTH).toMatch(/const RECAPTCHA_CONTAINER_ID = "[a-z0-9-]+";/);
    // ...handed to Firebase by that name, never as a re-typed literal...
    expect(AUTH).toContain("firebasePhoneSurface(FIREBASE_WEB.config, RECAPTCHA_CONTAINER_ID)");
    // ...and rendered by that same name.
    expect(AUTH).toContain("<div id={RECAPTCHA_CONTAINER_ID} />");
  });

  it("renders the node outside the code-sent branch, so it exists at first send", () => {
    // The verifier is built during the FIRST send, and the node has to be
    // mounted before that. Put it inside the `{!otpSent ? … : …}` ternary and
    // it arrives one render too late or disappears on the step that needs it.
    //
    // COUNTING BRACES, NOT LOOKING FOR ONE. The first version of this test
    // asserted that `)}` appears between the ternary and the div — and that
    // string appears inside the form too (`onChange={(e) => …)}`), so it
    // passed identically with the div moved INTO the branch. Measured both
    // ways: net braces 0 when the div is outside, 1 when it is inside.
    const div = AUTH.indexOf("<div id={RECAPTCHA_CONTAINER_ID} />");
    const branch = AUTH.indexOf("{!otpSent ? (");
    expect(branch).toBeGreaterThan(-1);
    expect(div).toBeGreaterThan(branch);
    const between = AUTH.slice(branch, div);
    const net = between.split("{").length - between.split("}").length;
    expect(net).toBe(0);
  });
});

describe("the MSG91 path stays removed", () => {
  const SOURCES = [
    "src/routes/auth.tsx",
    "src/lib/otpFlow.ts",
    "src/lib/phoneAuth.ts",
    "src/lib/firebasePhoneOtp.ts",
    "src/lib/flags.ts",
  ];

  // Comments are where the removal is EXPLAINED, so they are allowed to name
  // MSG91; code is not. Stripping them is what makes this assertion about
  // behaviour instead of about prose.
  const codeOf = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // CASE MATTERS, and getting it wrong made this test fail on the code it is
  // meant to bless: the widget's `sendOTP` and the flow's own `sendOtp`
  // collapse to the same string once lowercased, as do `verifyOTP` and
  // `verifyOtpCode`. The vendor names are matched exactly; only the brand
  // names, which appear in URLs and ids of every casing, are matched loosely.
  const VENDOR_IDENTIFIERS = ["sendOTP", "verifyOTP", "retryOTP", "initSendOTP", "toWidgetFormat"];
  const BRANDS = ["msg91", "phone91", "otp-provider.js"];

  it.each(SOURCES)("%s calls no MSG91 API", (path) => {
    const code = codeOf(read(path));
    for (const marker of VENDOR_IDENTIFIERS) expect(code).not.toContain(marker);
    for (const brand of BRANDS) expect(code.toLowerCase()).not.toContain(brand);
  });

  it.each([
    "send-otp",
    "verify-otp",
    "msg91-verify-session",
    "get-otp-config",
    "check-user-exists",
  ])("supabase/functions/%s is deleted", (fn) => {
    expect(existsSync(join(process.cwd(), "supabase/functions", fn))).toBe(false);
  });

  it("leaves no config block naming a deleted function", () => {
    const toml = read("supabase/config.toml");
    for (const fn of [
      "send-otp",
      "verify-otp",
      "msg91-verify-session",
      "get-otp-config",
      "check-user-exists",
    ]) {
      expect(toml).not.toContain(`[functions.${fn}]`);
    }
    // The replacement is declared, and needs verify_jwt off: its caller is not
    // signed in yet, which is the entire point of the endpoint.
    expect(toml).toContain("[functions.firebase-phone-session]");
  });
});
