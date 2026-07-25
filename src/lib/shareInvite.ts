// Messaging layer for the "bring ONIQ to my area" invite: heartfelt copy +
// share targets (email, SMS, native share). Pure builders are testable; only
// nativeShare touches browser APIs.

import { REGION_PROVIDER_TARGET } from "./regionService";

export function buildInviteMessage(regionLabel: string, providerCount?: number): string {
  const region = regionLabel.trim() || "our area";
  const progress =
    typeof providerCount === "number" && providerCount > 0
      ? `${providerCount} neighbours have already signed up — just ${Math.max(0, REGION_PROVIDER_TARGET - providerCount)} more to go!`
      : `We need ${REGION_PROVIDER_TARGET} local partners to switch it on.`;
  return (
    `Hey! 💚 Something good is coming to ${region}.\n\n` +
    `ONIQ opens its home-services network in a place the moment ${REGION_PROVIDER_TARGET} local ` +
    `service providers register — electricians, tutors, cooks, mehndi artists, anyone with a skill. ` +
    `${progress}\n\n` +
    `If you (or someone you love) earns with their hands or their heart, this is a free stage for it. ` +
    `Booking is 100% free — ONIQ charges nothing.\n\n` +
    `Join from the ONIQ app → earn → become a partner 💼\n` +
    `https://oniqhub.com`
  );
}

export const INVITE_SUBJECT = "Bring ONIQ services to our area 💚";

export function emailShareUrl(message: string, subject: string = INVITE_SUBJECT): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

/**
 * sms: URL that works on both platforms — iOS wants `&`-joined body after
 * `sms:;`, Android accepts `sms:?body=`. The `sms:?&body=` form is the widely
 * compatible middle ground for a recipient-less compose.
 */
export function smsShareUrl(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}

/** Prefer the native share sheet when present; report whether it handled it. */
export async function nativeShare(
  message: string,
  title: string = INVITE_SUBJECT,
): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      await navigator.share({ title, text: message });
      return true;
    }
  } catch {
    /* user cancelled or unsupported — fall through */
  }
  return false;
}
