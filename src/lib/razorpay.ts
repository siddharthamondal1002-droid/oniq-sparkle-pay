/**
 * Paying for an order with Razorpay, from the browser.
 *
 * THE BROWSER NEVER NAMES A PRICE. It sends an order id; the server reads
 * `orders.total`, which `place_order` computed from `menu_items`. Everything in
 * this file is presentation of a decision already made on the server, and the
 * one value it does receive — `amountMinor` — is for display, never for the
 * charge.
 *
 * AND IT NEVER DECIDES THAT A PAYMENT SUCCEEDED. Razorpay's callback hands back
 * a signature; `razorpay-verify` checks it against the key secret and only then
 * does an order become paid. `payments` is not writable by `authenticated` at
 * all, so there is no path from this file to "paid" that does not pass a
 * signature check.
 *
 * PHYSICAL GOODS ONLY. Google Play permits a third-party processor for
 * real-world goods and services and requires Play Billing for digital content
 * consumed in the app. This is wired to food orders. Pointing it at Story
 * seconds or a premium tier would be a policy violation, not a feature.
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
  const start = (data ?? {}) as {
    configured?: boolean;
    missing?: string[];
    keyId?: string;
    providerOrderId?: string;
    amountMinor?: number;
    currency?: string;
    error?: string;
  };
  if (error || start.error) {
    return { status: "failed", message: start.error ?? error?.message ?? "Could not start that payment." };
  }
  if (start.configured === false) {
    return { status: "failed", message: "Payments are not set up yet." };
  }
  if (!start.keyId || !start.providerOrderId) {
    return { status: "failed", message: "Could not start that payment." };
  }

  const Checkout = await loadCheckout();

  return new Promise<PayResult>((resolve) => {
    let settled = false;
    const finish = (r: PayResult) => {
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
      description: opts.description ?? "Order payment",
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
          const payload = (verified.data ?? {}) as { ok?: boolean; error?: string };
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
          finish({ status: "paid", orderId: opts.orderId });
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
