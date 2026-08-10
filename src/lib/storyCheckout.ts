/**
 * Buying Story seconds. THE MONEY IS ALWAYS TAKEN ON THE WEBSITE.
 *
 * TWO SURFACES, ONE RAIL. In a browser this opens Razorpay Checkout inline and
 * the purchase completes where the user already is. In the native app it does
 * NOT open Checkout — it hands the URL to the system browser and stops. The
 * payment then happens on oniqhub.com, in a real browser tab, against the same
 * edge functions. Nothing about the charge differs; only where it is entered.
 *
 * WHY. A Story is digital content consumed in the app, and Google Play requires
 * Play Billing for that. ONIQ's position is that the app never takes the
 * payment at all. Two things follow, and both are load-bearing:
 *
 *   THE HANDOFF IS A CONFIG ROW, not a constant. `nativeLinkOut` comes from
 *   story_purchase_config via story_quota_status. Play's stance on linking out
 *   differs by country and has moved more than once; if it moves again the fix
 *   is an UPDATE, because a policy strike lands immediately and an app
 *   resubmission takes days. With it off, the app simply does not offer the
 *   purchase and the website keeps selling — the reader-app shape.
 *
 *   THE WEB PAGE IS NOT A SHIM. /pay/story is a real, standalone, linkable
 *   checkout that works for somebody who typed it in. That is what makes the
 *   switch above safe to flip: turning off the in-app button removes a
 *   shortcut, not the product.
 *
 * THE BROWSER NEVER NAMES A PRICE — same rule as the food rail. It sends a tier
 * LENGTH; `create_story_purchase` reads the amount out of `story_price_tiers`.
 * And it never decides that a payment succeeded: the signature is checked by
 * `razorpay-verify`, and `paid_seconds` is writable by no client path at all.
 */
import { supabase } from "@/integrations/supabase/client";

/** Razorpay's own script. Loaded on demand, once. */
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCtor = new (options: Record<string, unknown>) => {
  open: () => void;
  on: (event: string, cb: (e: unknown) => void) => void;
};

let loading: Promise<RazorpayCtor> | null = null;

function loadCheckout(): Promise<RazorpayCtor> {
  const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;

  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Razorpay loaded but did not register"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not reach Razorpay. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Is this the native shell?
 *
 * Dynamic import and optional calls throughout, matching the fifteen other
 * places in this codebase that ask the same question: a web build must not fail
 * because a Capacitor global is absent.
 *
 * A THROWN IMPORT MEANS WEB, and that is worth justifying rather than assuming,
 * because a wrong answer in that direction opens a checkout inside the app —
 * the one thing this module exists to prevent. @capacitor/core is a hard
 * dependency and is bundled into the native shell, so it cannot fail to import
 * THERE; a failure means the module is absent, which only happens off-native.
 * The genuinely dangerous case would be isNativePlatform() lying, and nothing
 * here can defend against that — the whole app already trusts it.
 */
export async function isNativeShell(): Promise<boolean> {
  try {
    const core = (await import("@capacitor/core")) as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    return core.Capacitor?.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

export type CheckoutTarget =
  /** Run Razorpay Checkout right here. */
  | { where: "inline" }
  /** Send the user to the website; the app must not take this payment. */
  | { where: "browser"; url: string }
  /** Buying is switched off for this surface entirely. */
  | { where: "unavailable"; reason: string };

export type PurchaseConfig = {
  purchaseEnabled: boolean;
  nativeLinkOut: boolean;
  checkoutUrl: string | null;
};

/**
 * Where this purchase is allowed to happen.
 *
 * PURE, and separated from the act of paying so it can be tested without a
 * browser or a Razorpay account. The routing decision is the part with policy
 * consequences, so it is the part that gets asserted.
 */
export function checkoutTarget(
  cfg: PurchaseConfig,
  native: boolean,
  seconds: number,
): CheckoutTarget {
  if (!cfg.purchaseEnabled) {
    return { where: "unavailable", reason: "Buying Story time is paused right now." };
  }
  if (!native) return { where: "inline" };

  // Native from here down. Without a link-out the app offers nothing — and says
  // where the product IS, because "unavailable" with no explanation reads as a
  // bug and generates support mail.
  if (!cfg.nativeLinkOut) {
    return { where: "unavailable", reason: "Story time can be bought on oniqhub.com." };
  }
  if (!cfg.checkoutUrl || !/^https:\/\//.test(cfg.checkoutUrl)) {
    // A missing or non-https target is a misconfiguration, and the safe
    // response is to sell nothing rather than to open something unexpected.
    return { where: "unavailable", reason: "Story time can be bought on oniqhub.com." };
  }
  return { where: "browser", url: `${cfg.checkoutUrl}?seconds=${encodeURIComponent(seconds)}` };
}

/** Open a URL outside the app, preferring Capacitor's browser on native. */
async function openExternally(url: string): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ "@capacitor/browser");
    await mod.Browser.open({ url, presentationStyle: "popover", toolbarColor: "#0E0F13" });
    return;
  } catch {
    // Fall through — an anchor click works where window.open is blocked.
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener,noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type BuyResult =
  | { status: "paid"; seconds: number }
  | { status: "handed-off" }
  | { status: "dismissed" }
  | { status: "failed"; message: string };

export type BuyOptions = {
  /** A tier length in seconds. The server decides what that costs. */
  seconds: number;
  cfg: PurchaseConfig;
  prefill?: { name?: string; email?: string; contact?: string };
  /** Injected in tests. */
  native?: boolean;
};

/**
 * Buy Story seconds, wherever this is allowed to happen.
 *
 * On native the return is `handed-off` and that is a SUCCESS, not a failure —
 * the browser is open and the purchase continues there. The caller should say
 * "finish in your browser" and refresh the balance when the app resumes, rather
 * than showing an error.
 */
export async function buyStorySeconds(opts: BuyOptions): Promise<BuyResult> {
  const native = opts.native ?? (await isNativeShell());
  const target = checkoutTarget(opts.cfg, native, opts.seconds);

  if (target.where === "unavailable") return { status: "failed", message: target.reason };
  if (target.where === "browser") {
    await openExternally(target.url);
    return { status: "handed-off" };
  }

  // razorpay-order, not a Story-specific function. It takes EITHER an
  // `orderId` (a food order) or `seconds` (Story time) and refuses both at
  // once. The two products were meant to live in separate functions and do not,
  // because Lovable's platform cannot create new Supabase edge functions in a
  // TanStack project — see the header of razorpay-order for the whole story.
  const { data, error } = await supabase.functions.invoke("razorpay-order", {
    body: { seconds: opts.seconds, origin: "web" },
  });
  const start = (data ?? {}) as {
    configured?: boolean;
    keyId?: string;
    providerOrderId?: string;
    amountMinor?: number;
    currency?: string;
    seconds?: number;
    label?: string;
    error?: string;
  };
  if (error || start.error) {
    return {
      status: "failed",
      message: start.error ?? error?.message ?? "Could not start that payment.",
    };
  }
  if (start.configured === false)
    return { status: "failed", message: "Payments are not set up yet." };
  if (!start.keyId || !start.providerOrderId) {
    return { status: "failed", message: "Could not start that payment." };
  }

  const Checkout = await loadCheckout();

  return new Promise<BuyResult>((resolve) => {
    let settled = false;
    const finish = (r: BuyResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const rzp = new Checkout({
      key: start.keyId,
      order_id: start.providerOrderId,
      // Display only. Razorpay charges what the ORDER says, and the order was
      // created server-side from the tier table.
      amount: start.amountMinor,
      currency: start.currency ?? "INR",
      name: "ONIQ",
      description: start.label ? `${start.label} of Story time` : "Story time",
      prefill: opts.prefill ?? {},
      theme: { color: "#12d6a3" },
      // UPI first, intent flow first within it — the same sequencing as the food
      // rail, and for the same reason: it hands off to the payer's own UPI app,
      // which is what a payment button is expected to do in India. Cards and
      // netbanking stay available, just second.
      config: {
        display: {
          blocks: {
            upi: {
              name: "Pay with your UPI app",
              instruments: [{ method: "upi", flows: ["intent", "collect", "qr"] }],
            },
          },
          sequence: ["block.upi"],
          preferences: { show_default_blocks: true },
        },
      },
      modal: { ondismiss: () => finish({ status: "dismissed" }) },
      handler: (response: RazorpayHandlerResponse) => {
        void (async () => {
          const verified = await supabase.functions.invoke("razorpay-verify", {
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });
          const payload = (verified.data ?? {}) as {
            ok?: boolean;
            seconds?: number;
            error?: string;
          };
          if (verified.error || payload.error || !payload.ok) {
            // The money may well have gone. Saying "failed" here would be a lie
            // in the direction that makes somebody pay twice — and the webhook
            // is still coming, which is the authoritative confirmation.
            finish({
              status: "failed",
              message:
                payload.error ??
                "Payment taken, but we could not confirm it yet. Your Story time will appear shortly — do not pay again.",
            });
            return;
          }
          finish({ status: "paid", seconds: payload.seconds ?? opts.seconds });
        })();
      },
    });

    rzp.on("payment.failed", (e: unknown) => {
      const desc = (e as { error?: { description?: string } })?.error?.description;
      finish({ status: "failed", message: desc ?? "That payment did not go through." });
    });

    rzp.open();
  });
}
