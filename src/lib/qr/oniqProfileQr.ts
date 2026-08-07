// Track A3 — ONIQ profile QR codes.
//
// WHAT THE LOOP EXPECTED, AND WHAT IS ACTUALLY THERE
//
// The loop's guardrail says decodeQr.ts "handles UPI strings only" and that
// adding a second format is where payments could break. Reading the code, that
// is not the shape of it, and the difference is worth stating because it
// removes the risk rather than managing it:
//
//   decodeQr.ts turns an IMAGE into a STRING. It is entirely format-agnostic
//   and knows nothing about UPI. It does not need to change, and has not.
//
//   parseUpiUri (in app.scan.tsx) turns a string into UPI params, and already
//   returns null for anything that is not `upi://pay?...`. It does not need to
//   change either, and has not.
//
// So a second format is a NEW parser beside the old one plus an ordered
// dispatch — no edit to anything on the payment path. That is a strictly safer
// change than the one the loop budgeted for.
//
// WHY AN HTTPS URL AND NOT A CUSTOM SCHEME
//
// `oniq://u/<token>` would be shorter and could not collide with `upi://`. But
// a QR is scanned by whatever camera is to hand, and a custom scheme scanned
// by the system camera does nothing useful on a phone without ONIQ installed —
// which is every phone this growth loop is trying to reach.
//
// An https URL on ONIQ's own origin scans everywhere: inside ONIQ it resolves
// in-app, and in any other scanner it opens a web page that can offer the app.
// It also cannot possibly be mistaken for a UPI URI, since UPI requires the
// literal `upi://pay?` prefix — the schemes do not overlap at all.
//
// REVOCABLE BY CONSTRUCTION
//
// The QR encodes a TOKEN, never the user id. A user id is forever: share it
// once and it is public for good. A token can be rotated, which turns "I put
// my QR in a WhatsApp group and now strangers scan it" from a permanent
// problem into a button.
//
// What that DOES NOT mean, so the UI copy does not overstate it: /u/<user_id>
// is already a public profile page, so rotating a token does not make anyone
// unreachable. It kills one printed, forwarded or screenshotted code. That is
// the whole of the claim.
//
// WHY /q/ AND NOT /u/
//
// /u/<user_id> already exists as a public SSR profile route. Two reasons not
// to reuse it:
//
//   1. A uuid is 36 characters of [A-Za-z0-9-], which MATCHES the token
//      charset below. Under one path a token and a user id would be
//      indistinguishable, and the resolver would have to guess.
//   2. The path then says which kind of link it is. /u/ is permanent, /q/ is
//      revocable, and that difference is worth being able to see.

/** ONIQ's own origin. A QR pointing anywhere else is not ours. */
export const PROFILE_QR_ORIGIN = "https://oniqhub.com";

/**
 * The path segment. Short, because QR density is a function of length, and
 * distinct from /u/ because a user id would otherwise parse as a token.
 */
export const PROFILE_QR_PATH = "/q/";

/**
 * Token charset and length.
 *
 * 22 chars of url-safe base64 is ~132 bits — far beyond guessing, and short
 * enough to keep the QR readable at small sizes on a cracked screen in poor
 * light, which is the actual scanning condition.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type ProfileQr = { token: string; url: string };

/** Build the URL a profile QR encodes. */
export function profileQrUrl(token: string): string {
  if (!TOKEN_RE.test(token)) throw new Error("invalid profile QR token");
  return `${PROFILE_QR_ORIGIN}${PROFILE_QR_PATH}${token}`;
}

/**
 * Parse a scanned string as an ONIQ profile QR, or return null.
 *
 * Deliberately strict. Everything below is a rejection rather than a
 * best-effort recovery, because a profile QR that "nearly" parses would
 * connect a user to the wrong person, and there is no cost to making the
 * sender rescan.
 */
export function parseProfileQr(raw: string): ProfileQr | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  // Cheap reject before constructing a URL: anything not starting with our
  // exact origin cannot be ours, and this also short-circuits every UPI
  // string without ever looking at it.
  if (!s.toLowerCase().startsWith(`${PROFILE_QR_ORIGIN}${PROFILE_QR_PATH}`.toLowerCase())) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  // Re-check origin against the PARSED url, not the raw string. A crafted
  // input like "https://oniqhub.com/u/x@evil.test/" passes a prefix check and
  // has a different host once parsed — this is the check that catches it.
  if (url.origin !== PROFILE_QR_ORIGIN) return null;
  if (url.protocol !== "https:") return null;

  // Exactly /q/<token>. No extra segments, so a longer path cannot smuggle
  // anything past a loose match.
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || `/${parts[0]}/` !== PROFILE_QR_PATH) return null;

  const token = parts[1];
  if (!TOKEN_RE.test(token)) return null;

  return { token, url: s };
}

/**
 * What a scanned code turned out to be.
 *
 * `upi` is first in the union and first in the dispatch, and both orderings
 * are deliberate — see resolveScannedCode.
 */
export type ScanKind =
  | { kind: "upi"; raw: string }
  | { kind: "oniq-profile"; token: string; raw: string }
  | { kind: "unknown"; raw: string };

/**
 * Decide what a scanned string is. UPI ALWAYS wins.
 *
 * The order here is the safety property of this whole feature. A UPI string
 * must resolve as UPI every time, before any other format is even considered,
 * so this asks the payment question first and returns immediately on a match.
 *
 * `isUpi` is injected rather than imported so this stays a pure function with
 * no import edge into the payment module — app.scan.tsx passes its own
 * parseUpiUri, which means the dispatch tests the REAL parser and there is no
 * second copy of the UPI rules to drift.
 */
export function resolveScannedCode(raw: string, isUpi: (s: string) => boolean): ScanKind {
  const s = (raw ?? "").trim();

  // 1. Payments. First, always, unconditionally.
  if (isUpi(s)) return { kind: "upi", raw: s };

  // 2. ONIQ profile.
  const profile = parseProfileQr(s);
  if (profile) return { kind: "oniq-profile", token: profile.token, raw: s };

  // 3. Anything else is handed back untouched for the caller to explain.
  return { kind: "unknown", raw: s };
}
