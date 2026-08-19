// Track B3 — starting a creator subscription from the phone.
//
// RevenueCat wraps Play Billing; ONIQ still owns the entitlement. What Play
// sells is a TIER (one of four shared SKUs — see economics.ts for why a
// product per creator is impossible). Who the money is for travels in the
// obfuscated identifiers on the purchase, and the server resolves that into a
// creator when the RTDN worker fetches the real purchase state from the Play
// Developer API.
//
// TWO CONCURRENT PURCHASES OF THE SAME SKU IS A NORMAL STATE, NOT A BUG. A
// subscriber backing two creators at Rs 99 holds two Play purchases of
// oniq_creator_99. Nothing in this file — or in the schema — may key a
// subscription by (subscriber, sku); the purchase token is the identity.
//
// The plugin is imported dynamically and only on a native build. Importing it
// at module scope would pull a Capacitor native bridge into the web bundle,
// where it throws on the first call and there is no Play Billing anyway.
import { Capacitor } from "@capacitor/core";
import { SUB_TIERS } from "./economics";

export type StartPurchase = {
  sku: string;
  creatorId: string;
  subscriberId: string;
};

export type PurchaseOutcome =
  | { ok: true; purchaseToken: string }
  | { ok: false; reason: "not-native" | "cancelled" | "self" | "error"; message: string };

export function isPurchaseAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export function tierForSku(sku: string) {
  return SUB_TIERS.find((t) => t.sku === sku) ?? null;
}

/**
 * Begin a subscription. Returns the Play purchase token; the earnings side of
 * it happens server-side when Play notifies us, NOT here — a client saying
 * "I paid" is not evidence that anyone paid.
 */
export async function startCreatorSubscription(input: StartPurchase): Promise<PurchaseOutcome> {
  // B8 — self-subscription is refused here for the user's sake (an immediate,
  // clear no) and again in the database, which is the control. This check is
  // the courtesy; record_creator_charge is the enforcement.
  if (input.creatorId === input.subscriberId) {
    return { ok: false, reason: "self", message: "You can't subscribe to your own channel" };
  }
  if (!isPurchaseAvailable()) {
    return {
      ok: false,
      reason: "not-native",
      message: "Creator subscriptions are available in the ONIQ Android app",
    };
  }
  try {
    const { Purchases } = await import("@revenuecat/purchases-capacitor");
    const apiKey = import.meta.env["VITE_REVENUECAT_ANDROID_KEY"] as string | undefined;
    if (!apiKey) {
      return { ok: false, reason: "error", message: "Billing is not configured yet" };
    }
    await Purchases.configure({ apiKey, appUserID: input.subscriberId });
    // The creator id rides along so Play's own record carries it; the server
    // reads it back from the Developer API rather than trusting this call.
    await Purchases.setAttributes({ oniq_creator_id: input.creatorId });
    const offerings = await Purchases.getOfferings();
    const pkg = Object.values(offerings.all)
      .flatMap((o) => o.availablePackages)
      .find((p) => p.product.identifier.startsWith(input.sku));
    if (!pkg) return { ok: false, reason: "error", message: "That tier isn't available right now" };
    const res = await Purchases.purchasePackage({ aPackage: pkg });
    const token =
      (res.transaction as { transactionIdentifier?: string } | undefined)?.transactionIdentifier ??
      "";
    return { ok: true, purchaseToken: token };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return { ok: false, reason: "cancelled", message: "Purchase cancelled" };
    return { ok: false, reason: "error", message: msg };
  }
}
