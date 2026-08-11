/**
 * Paying with Razorpay, from the browser. Two products, one sheet.
 *
 * THE BROWSER NEVER NAMES A PRICE. For a food order it sends an order id and
 * the server reads `orders.total`; for Story time it sends a tier LENGTH and
 * `create_story_purchase` reads the price out of `story_price_tiers`.
 * Everything in this file is presentation of a decision already made on the
 * server, and the one value it does receive — `amountMinor` — is for display,
 * never for the charge.
 *
 * AND IT NEVER DECIDES THAT A PAYMENT SUCCEEDED. Razorpay's callback hands back
 * a signature; `razorpay-verify` checks it against the key secret and only then
 * does anything become paid. Neither `payments` nor `story_purchases` is
 * writable by `authenticated` at all, so there is no path from this file to
 * "paid" that does not pass a signature check.
 *
 * WHERE THE MONEY MAY BE COLLECTED is the Play-policy line, and it is drawn per
 * product. Food is real-world goods, which Play permits a third-party processor
 * for — `payForOrder` runs anywhere the app runs. Story time is digital content
 * consumed in the app, so the NATIVE build never collects it: `checkoutTarget`
 * in storyPricing.ts sends native users to the website in a browser, and
 * `payForStorySeconds` is reached only by web pages. Nothing here can verify
 * which surface it is running on — a check would be one spoofed header from
 * meaningless — so the server records the claimed origin on the purchase row
 * instead, where a lie is at least visible.
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

/**
 * Load Checkout, once per session.
 *
 * Cached as a PROMISE rather than a boolean so two taps a moment apart await
 * the same load instead of injecting two script tags — the second would
 * redefine window.Razorpay while the first checkout was open.
 */
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
      // Reset so a later attempt can retry rather than await a promise that
      // will never settle — a checkout that fails once on a bad connection
      // should not be permanently broken for the session.
      loading = null;
      reject(new Error("Could not reach Razorpay. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type PayResult =
  | { status: "paid"; orderId: string }
  | { status: "dismissed" }
  | { status: "failed"; message: string };

export type PayOptions = {
  /** ONIQ's order id. The only thing that decides what is charged. */
  orderId: string;
  /** Shown in the Razorpay sheet. Cosmetic. */
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
};

/** What `razorpay-order` answers for either product. */
type OrderStart = {
  configured?: boolean;
  missing?: string[];
  keyId?: string;
  providerOrderId?: string;
  amountMinor?: number;
  currency?: string;
  seconds?: number;
  label?: string;
  error?: string;
};

/** What `razorpay-verify` settles to, after the signature check. */
type VerifyPayload = { ok?: boolean; error?: string; seconds?: number };

type CollectOutcome =
  | { status: "verified"; payload: VerifyPayload }
  | { status: "dismissed" }
  | { status: "failed"; message: string };

/**
 * Open the sheet for a provider order that already exists, and report what
 * actually happened. Shared by both products so the UPI sequencing and the
 * verify discipline cannot drift between them.
 */
async function collectPayment(
  start: { keyId: string; providerOrderId: string; amountMinor?: number; currency?: string },
  opts: { description: string; prefill?: PayOptions["prefill"] },
): Promise<CollectOutcome> {
  const Checkout = await loadCheckout();

  return new Promise<CollectOutcome>((resolve) => {
    let settled = false;
    const finish = (r: CollectOutcome) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const rzp = new Checkout({
      key: start.keyId,
      order_id: start.providerOrderId,
      // Passed for display only. Razorpay charges what the ORDER says, which
      // was created server-side — a tampered value here changes the label and
      // nothing else.
      amount: start.amountMinor,
      currency: start.currency ?? "INR",
      name: "ONIQ",
      description: opts.description,
      prefill: opts.prefill ?? {},
      theme: { color: "#12d6a3" },
      // UPI FIRST, AND THE INTENT FLOW FIRST WITHIN IT.
      //
      // `intent` is the one that hands off to the payer's own UPI app — the
      // GPay/PhonePe/Paytm chooser opens, they approve there, and they come
      // back. That is the behaviour people in India expect from a payment
      // button, and it is why this is sequenced ahead of cards rather than
      // buried under them.
      //
      // THE MONEY STILL ROUTES THROUGH RAZORPAY, which is the whole difference
      // from the Scan & Pay screen. That one builds a raw `upi://` link and
      // ONIQ never learns what happened. This one is a Razorpay order: it
      // settles to ONIQ's merchant account, fires the webhook, and flips the
      // order to paid. Same app opens in the payer's hand; completely
      // different accounting.
      //
      // `collect` and `qr` stay as fallbacks — intent needs a UPI app actually
      // installed, and on desktop there is none — and the default blocks stay
      // on so a card or netbanking payer is not blocked, only sequenced second.
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
      modal: {
        ondismiss: () => finish({ status: "dismissed" }),
      },
      handler: (response: RazorpayHandlerResponse) => {
        void (async () => {
          const verified = await supabase.functions.invoke("razorpay-verify", {
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });
          const payload = (verified.data ?? {}) as VerifyPayload;
          if (verified.error || payload.error || !payload.ok) {
            // The money may well have left their account — Razorpay took it.
            // Saying "payment failed" here would be a lie in the direction that
            // makes somebody pay twice. The webhook is still coming, and it is
            // the authoritative confirmation.
            finish({
              status: "failed",
              message:
                payload.error ??
                "Payment taken, but we could not confirm it yet. It will update shortly — do not pay again.",
            });
            return;
          }
          finish({ status: "verified", payload });
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

/** The refusals every start shares, or null when the sheet may open. */
function startProblem(error: { message: string } | null, start: OrderStart): string | null {
  if (error || start.error) {
    return start.error ?? error?.message ?? "Could not start that payment.";
  }
  if (start.configured === false) return "Payments are not set up yet.";
  if (!start.keyId || !start.providerOrderId) return "Could not start that payment.";
  return null;
}

/**
 * Take a payment for one order, and report what actually happened.
 *
 * THREE OUTCOMES, ALL REAL. A dismissed checkout is not a failure — the user
 * changed their mind and the order stays unpaid and payable. Collapsing that
 * into an error trains people to ignore payment errors.
 */
export async function payForOrder(opts: PayOptions): Promise<PayResult> {
  const { data, error } = await supabase.functions.invoke("razorpay-order", {
    body: { orderId: opts.orderId },
  });
  const start = (data ?? {}) as OrderStart;
  const problem = startProblem(error, start);
  if (problem) return { status: "failed", message: problem };

  const out = await collectPayment(
    start as { keyId: string; providerOrderId: string; amountMinor?: number; currency?: string },
    { description: opts.description ?? "Order payment", prefill: opts.prefill },
  );
  if (out.status === "verified") return { status: "paid", orderId: opts.orderId };
  return out;
}

export type StoryPayOptions = {
  /** A tier length from `story_price_tiers`. The only thing that decides the price. */
  seconds: number;
  /**
   * Which surface the user STARTED on. "native-handoff" when the page was
   * opened by the app's link-out. Provenance, not authorisation — the server
   * records it on the purchase row and trusts it for nothing else.
   */
  origin?: "web" | "native-handoff";
  prefill?: PayOptions["prefill"];
};

export type StoryPayResult =
  | { status: "paid"; seconds: number }
  | { status: "dismissed" }
  | { status: "failed"; message: string };

/**
 * Buy Story time. WEB PAGES ONLY — the native build links out to /pay/story
 * instead of calling this; see `checkoutTarget` in storyPricing.ts for where
 * that decision lives and the migration for why it is a config row.
 *
 * On "paid", `seconds` is what `credit_story_purchase` actually credited —
 * read back from the verify response, not echoed from the request.
 */
export async function payForStorySeconds(opts: StoryPayOptions): Promise<StoryPayResult> {
  const { data, error } = await supabase.functions.invoke("razorpay-order", {
    body: { seconds: opts.seconds, origin: opts.origin ?? "web" },
  });
  const start = (data ?? {}) as OrderStart;
  const problem = startProblem(error, start);
  if (problem) return { status: "failed", message: problem };

  const out = await collectPayment(
    start as { keyId: string; providerOrderId: string; amountMinor?: number; currency?: string },
    { description: start.label ?? "Story time", prefill: opts.prefill },
  );
  if (out.status === "verified") {
    return {
      status: "paid",
      seconds:
        typeof out.payload.seconds === "number" && out.payload.seconds > 0
          ? out.payload.seconds
          : opts.seconds,
    };
  }
  return out;
}

export type ChannelSubPayResult =
  | { status: "paid"; channelName: string }
  | { status: "dismissed" }
  | { status: "failed"; message: string };

/**
 * Subscribe to a creator's channel for a month. WEB PAGES ONLY — the native
 * build links out to /pay/subscribe, the same posture as Story time and for
 * the same Play Billing reason. The server names the price; the webhook (or
 * the verify callback, whichever lands first) settles the three-way split —
 * creator, ONIQ, subscriber cashback — atomically in
 * credit_channel_subscription.
 */
export async function payForChannelSub(opts: {
  channelId: string;
  origin?: "web" | "native-handoff";
  prefill?: PayOptions["prefill"];
}): Promise<ChannelSubPayResult> {
  const { data, error } = await supabase.functions.invoke("razorpay-order", {
    body: { channelId: opts.channelId, origin: opts.origin ?? "web" },
  });
  const start = (data ?? {}) as OrderStart & { channelName?: string };
  const problem = startProblem(error, start);
  if (problem) return { status: "failed", message: problem };

  const out = await collectPayment(
    start as { keyId: string; providerOrderId: string; amountMinor?: number; currency?: string },
    { description: `${start.channelName ?? "Channel"} — 1 month`, prefill: opts.prefill },
  );
  if (out.status === "verified") {
    return { status: "paid", channelName: start.channelName ?? "the channel" };
  }
  return out;
}
