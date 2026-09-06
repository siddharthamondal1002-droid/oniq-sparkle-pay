// Pure phone-auth helpers: E.164 normalization, validation, OTP format and
// resend policy. No I/O — everything here is unit-testable.

export type Country = { flag: string; dial: string; label: string; iso: string };

export const COUNTRIES: Country[] = [
  { flag: "🇮🇳", dial: "+91", label: "India", iso: "IN" },
  { flag: "🇺🇸", dial: "+1", label: "USA", iso: "US" },
  { flag: "🇬🇧", dial: "+44", label: "UK", iso: "GB" },
  { flag: "🇦🇪", dial: "+971", label: "UAE", iso: "AE" },
  { flag: "🇸🇬", dial: "+65", label: "Singapore", iso: "SG" },
  { flag: "🇧🇩", dial: "+880", label: "Bangladesh", iso: "BD" },
  { flag: "🇳🇵", dial: "+977", label: "Nepal", iso: "NP" },
  { flag: "🇱🇰", dial: "+94", label: "Sri Lanka", iso: "LK" },
];

/** Strip spaces, dashes, dots and parentheses from user input. */
export function cleanNationalNumber(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

/**
 * Validate the national (local) part for a given dial code.
 * India gets the strict mobile rule (10 digits, starts 6-9); other countries
 * get the E.164 length window for national significant numbers.
 */
export function isValidNationalNumber(dial: string, raw: string): boolean {
  const n = cleanNationalNumber(raw);
  if (!/^[0-9]+$/.test(n)) return false;
  if (dial === "+91") return /^[6-9][0-9]{9}$/.test(n);
  const total = dial.replace(/\D/g, "").length + n.length;
  return n.length >= 6 && n.length <= 12 && total >= 8 && total <= 15;
}

/**
 * Build an E.164 number (+<country><national>) or null when invalid.
 * Never guesses a country: the dial code must be chosen explicitly.
 */
export function toE164(dial: string, raw: string): string | null {
  if (!/^\+[0-9]{1,3}$/.test(dial)) return null;
  if (!isValidNationalNumber(dial, raw)) return null;
  return dial + cleanNationalNumber(raw);
}

export function isValidOtp(code: string): boolean {
  return /^[0-9]{6}$/.test(code.trim());
}

export const MAX_RESENDS = 3;
/** OTPs sent by the provider expire server-side; surface this in the UX. */
export const OTP_EXPIRY_MINUTES = 5;

/**
 * Escalating client-side cooldown (seconds) after the Nth send: attempt 1 is
 * the initial send, attempts 2..MAX_RESENDS+1 are resends. Returns null when
 * the send budget (1 initial + MAX_RESENDS resends) is exhausted — the caller
 * must restart the flow from the phone-number step.
 */
export function nextResendDelay(attempt: number): number | null {
  if (attempt < 1) return 0;
  if (attempt > MAX_RESENDS + 1) return null;
  return [30, 60, 120, 180][attempt - 1] ?? null;
}
