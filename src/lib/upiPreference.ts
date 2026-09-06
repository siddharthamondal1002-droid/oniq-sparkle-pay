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
 * Set the amount and note on a scanned URI, KEEPING EVERY OTHER FIELD.
 *
 * THIS EXISTS BECAUSE A COLLECTION QR CARRIES NO AMOUNT. Observed 2026-09-06:
 * a puja society's SBI collection QR (officerws@sbi, mc present, am absent)
 * scanned fine, and the moment ₹3,300 was typed the `rawIntact` guard in
 * app.upi.tsx went false — because the typed amount no longer equalled the
 * scanned one — and the launcher fell back to `upiPayeeLink`, which emits only
 * pa/pn/cu. mc, tr, mode, orgid and sign were all dropped, the banks saw a P2P
 * payment to a merchant account, and it failed after reaching settlement (UTR
 * 586505577554). The same QR works when paid inside PhonePe, which is the
 * control that proves the payee was never the problem.
 *
 * So editing the amount must AMEND the scanned query, never replace it.
 * Entering an amount on an amount-less merchant QR is the intended flow — it
 * is exactly what PhonePe does natively — so preserving mc while setting am is
 * the behaviour that matches the rest of the ecosystem.
 *
 * Order is preserved and untouched keys are copied verbatim, so a field ONIQ
 * has never heard of still reaches the payer's bank.
 */
export function amendUpiUri(raw: string, patch: { am?: string; tn?: string }): string {
  const q = raw.indexOf("?");
  if (q < 0 || !/^upi:\/\/pay\?/i.test(raw)) return raw;
  const params = new URLSearchParams(raw.slice(q + 1));
  const apply = (key: "am" | "tn", value: string | undefined) => {
    const v = (value ?? "").trim();
    if (v) params.set(key, v);
    else params.delete(key);
  };
  apply("am", patch.am);
  apply("tn", patch.tn);
  return "upi://pay?" + params.toString();
}
