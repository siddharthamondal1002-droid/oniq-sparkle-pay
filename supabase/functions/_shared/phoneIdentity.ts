/**
 * How a phone number becomes a Supabase account — ONE definition.
 *
 * Every phone sign-in path has to derive the SAME synthetic email from the
 * SAME normalised number, or the same human gets two accounts with two
 * wallets and two histories. That is not a theoretical risk: as of
 * 2026-09-05 this derivation was copy-pasted into `verify-otp` and
 * `msg91-verify-session`, and `normalizeIndian` into `send-otp` as well.
 * Three copies agreeing today is three chances to disagree tomorrow, and the
 * failure is silent — a returning user simply appears to be new.
 *
 * The existing copies are deliberately left in place rather than refactored
 * out from under three live auth paths; `phoneIdentityAgreement.test.ts`
 * fails if any of them drifts from this module.
 */

/**
 * India-only, matching what ONIQ already enforces everywhere else.
 *
 * Accepts `+91…`, `0091…`, `91…` and a bare ten digits, and refuses anything
 * that is not a valid Indian mobile (leading 6-9, ten digits). Returns the
 * bare ten digits, which is what the synthetic email is keyed on.
 */
export function normalizeIndian(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  const trimmed = digits.replace(/^0+/, "").replace(/^91/, "");
  return /^[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
}

/**
 * The account address for a phone user.
 *
 * `@oniq.phone` is not a deliverable domain, and that is the point: these
 * addresses exist to key an account, never to receive mail. Changing this
 * string orphans every existing phone account, so it is frozen by test.
 */
export const syntheticEmail = (phone: string) => `phone_${phone}@oniq.phone`;
