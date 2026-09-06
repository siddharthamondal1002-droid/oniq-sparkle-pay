/**
 * REMEMBER WHICH UPI APP THIS PERSON PAYS WITH, so the second payment onward
 * skips Android's app chooser and lands straight in their own app.
 *
 * Owner, 2026-09-06, on why ONIQ builds a `upi://pay` string at all: _"why
 * can't that just directly land to app"_. It does — the intent IS the direct
 * landing — but a bare `upi://` matches EVERY installed UPI app, so Android
 * interposes a chooser. Naming the app in the scheme removes it.
 *
 * ONIQ CANNOT LEARN THIS BY WATCHING. `App.openUrl` resolves with nothing:
 * there is no callback saying which app the chooser picked, and no permission
 * that would grant one. So the preference can only come from the person
 * TAPPING a named button. That is why the confirm sheet lists the apps rather
 * than firing a generic intent and inferring — an inference that is not
 * available cannot be built.
 *
 * PER DEVICE, NOT PER ACCOUNT — localStorage rather than the profile. Which
 * UPI apps exist is a fact about the handset in the hand, and the same person
 * on a second phone may have a different set installed. Mirroring this to the
 * profile the way `country.ts` mirrors Home would push a preference onto a
 * device that cannot honour it.
 *
 * IT IS A SHORTCUT, NEVER A LOCK. Every surface that uses this keeps a generic
 * "Any UPI app" route, and a targeted launch that fails falls back to it and
 * clears the preference — see `launchUpiIntent`. A remembered app that has
 * since been uninstalled must not be able to strand someone mid-payment.
 */

/** The apps whose schemes ONIQ can target. Mirrors UPI_APPS in miniapps.ts. */
export const UPI_APP_IDS = ["gpay", "phonepe", "paytm"] as const;
export type UpiAppId = (typeof UPI_APP_IDS)[number];

/**
 * Scheme PREFIXES, up to and including the "?".
 *
 * Retargeting swaps this prefix and keeps the query verbatim, which is what
 * lets a scanned merchant QR keep its unmodelled fields (mc, tr, tid, mode,
 * orgid, sign). Rebuilding the query from parsed parts would drop them and the
 * UPI app would decline the payment as unverified P2P — see the rawIntact
 * guard in app.upi.tsx and the round-trip proof in
 * src/lib/qr/__tests__/upiRoundTrip.test.ts.
 */
const PREFIX: Record<UpiAppId, string> = {
  gpay: "tez://upi/pay?",
  phonepe: "phonepe://pay?",
  paytm: "paytmmp://pay?",
};

export const UPI_APP_LABEL: Record<UpiAppId, string> = {
  gpay: "Google Pay",
  phonepe: "PhonePe",
  paytm: "Paytm",
};

const KEY = "oniq.upi.app";

export function isUpiAppId(v: unknown): v is UpiAppId {
  return typeof v === "string" && (UPI_APP_IDS as readonly string[]).includes(v);
}

/** The app to try first, or null for the OS chooser. Never throws. */
export function readPreferredUpiApp(): UpiAppId | null {
  try {
    const v = localStorage.getItem(KEY);
    return isUpiAppId(v) ? v : null;
  } catch {
    // Private mode, blocked site data, SSR — the chooser is the correct
    // fallback, so an unreadable preference is not an error worth surfacing.
    return null;
  }
}

export function rememberUpiApp(id: UpiAppId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* the shortcut simply will not stick; paying still works */
  }
}

export function forgetUpiApp(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/**
 * Point an existing `upi://pay?…` URI at one specific app, QUERY UNTOUCHED.
 *
 * Pure, and the whole reason this is a separate function: everything that
 * matters about a merchant payment lives in the query string, so the only safe
 * transformation is a prefix swap. Returns the input unchanged when there is no
 * preference or the input is not a UPI intent — callers can apply it
 * unconditionally.
 */
export function retargetUpiUri(uri: string, app: UpiAppId | null): string {
  if (!app) return uri;
  const q = uri.indexOf("?");
  if (q < 0) return uri;
  // Only rewrite what we recognise. A URI that is already app-specific, or is
  // not UPI at all, is left exactly as it is.
  if (!/^upi:\/\/pay\?/i.test(uri)) return uri;
  return PREFIX[app] + uri.slice(q + 1);
}

/** The generic intent, for the "Any UPI app" route and for fallback. */
export function genericUpiUri(uri: string): string {
  const q = uri.indexOf("?");
  if (q < 0) return uri;
  for (const p of Object.values(PREFIX)) {
    if (uri.toLowerCase().startsWith(p.slice(0, p.indexOf(":")).toLowerCase() + ":")) {
      return "upi://pay?" + uri.slice(q + 1);
    }
  }
  return uri;
}

/**
 * The app buttons to draw, last-used first.
 *
 * Order is the whole feature: the preferred app leads, so the common case is
 * one tap on the top button and no chooser. Every app still appears, because
 * a person who paid with GPay once must be able to pay with PhonePe next
 * without hunting for a setting.
 */
export function orderedPayApps(preferred: UpiAppId | null): UpiAppId[] {
  if (!preferred) return [...UPI_APP_IDS];
  return [preferred, ...UPI_APP_IDS.filter((id) => id !== preferred)];
}

/**
 * Does this scanned URI describe a MERCHANT rather than a person?
 *
 * `mc` is the merchant category code and is the field UPI apps and banks key
 * the P2M classification on; `mode`, `orgid` and `sign` travel with it on
 * Bharat-QR style codes. A person's QR carries none of them.
 *
 * The distinction is not cosmetic. A merchant payment sent WITHOUT these is
 * processed as person-to-person, and a current/collection account frequently
 * cannot receive P2P — the bank refuses with "UPI payments are not allowed on
 * either your account type or the receiver's account type", which is a true
 * statement about the account and a completely misleading one about the cause.
 */
export function isMerchantUpiUri(uri: string): boolean {
  const q = uri.indexOf("?");
  if (q < 0 || !/^upi:\/\/pay\?/i.test(uri)) return false;
  const p = new URLSearchParams(uri.slice(q + 1));
  return ["mc", "mode", "orgid", "sign"].some((k) => (p.get(k) ?? "").trim() !== "");
}

/**
 * Set the amount/note on a scanned URI WITHOUT re-encoding anything else.
 *
 * THE FIRST VERSION OF THIS ROUND-TRIPPED THROUGH URLSearchParams AND CORRUPTED
 * THE PAYLOAD. Executed against a real collection-QR shape, 2026-09-06:
 *
 *   pa   officerws@sbi                      -> officerws%40sbi
 *   pn   OFFICERS%20W%20SOCITY%20PUJA%20COM -> OFFICERS+W+SOCITY+PUJA+COM
 *
 * Both are legal encodings and both are WRONG here. `toString()` percent-encodes
 * `@` and emits `+` for space (form encoding, not RFC 3986 query encoding). UPI
 * apps are not uniform about decoding `pa`, so `officerws%40sbi` can be taken as
 * a literal handle that resolves to nothing, and a payee name renders as
 * "OFFICERS+W+SOCITY". Preserving mc/tr/sign is worthless if pa arrives mangled.
 *
 * So this edits the query as TEXT: the original bytes of every other parameter
 * are passed through untouched, in their original order.
 *
 * AND A SIGNED QR IS NEVER AMENDED AT ALL — this is the load-bearing rule.
 * `sign` covers the payload it was issued for. Appending `am` to a signed QR
 * leaves a signature that no longer matches what it signs, and an invalid
 * signature is exactly what a PSP refuses "for security reasons". There is no
 * way to re-sign it: only the merchant's PSP holds that key. The honest response
 * is to launch the signed QR EXACTLY as scanned and let the payer type the
 * amount inside their own UPI app, which is what every UPI app does natively
 * with a static signed QR. `amendUpiUri` returns the input unchanged in that
 * case, and callers must surface that to the user rather than silently dropping
 * the amount they typed — see `upiAmendability`.
 */
export type UpiAmendability = "amendable" | "signed-immutable" | "not-upi";

/** Can this scanned URI safely carry an amount ONIQ adds? */
export function upiAmendability(raw: string): UpiAmendability {
  const q = raw.indexOf("?");
  if (q < 0 || !/^upi:\/\/pay\?/i.test(raw)) return "not-upi";
  return /(^|&)sign=[^&]+/i.test(raw.slice(q + 1)) ? "signed-immutable" : "amendable";
}

export function amendUpiUri(raw: string, patch: { am?: string; tn?: string }): string {
  if (upiAmendability(raw) !== "amendable") return raw;
  const q = raw.indexOf("?");
  // Split on & only — never parse or re-serialise. Each pair keeps its own bytes.
  const pairs = raw.slice(q + 1).split("&").filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  const want: Record<string, string> = {};
  for (const key of ["am", "tn"] as const) {
    const v = (patch[key] ?? "").trim();
    if (v) want[key] = encodeURIComponent(v);
  }
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const k = (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
    if (k === "am" || k === "tn") {
      // Replace in place when the caller supplied one; drop it when they cleared it.
      if (k in want) {
        out.push(`${k}=${want[k]}`);
        seen.add(k);
      }
      continue;
    }
    out.push(pair); // untouched, original bytes
  }
  for (const k of Object.keys(want)) if (!seen.has(k)) out.push(`${k}=${want[k]}`);
  return "upi://pay?" + out.join("&");
}

/**
 * The app buttons to draw, last-used first.
 *
 * Order is the whole feature: the preferred app leads, so the common case is
 * one tap on the top button and no chooser. Every app still appears, because
 * a person who paid with GPay once must be able to pay with PhonePe next
 * without hunting for a setting.
 */
