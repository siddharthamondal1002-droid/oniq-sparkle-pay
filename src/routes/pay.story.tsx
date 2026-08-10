/**
 * /pay/story — where Story time is bought. Always.
 *
 * A REAL PAGE, NOT A HANDOFF SHIM. The native app links here rather than
 * collecting in-app, but this page has to stand on its own: somebody who typed
 * the URL, or followed a link from the pricing chart, must be able to buy here
 * with no app involved. That is precisely what makes the in-app link-out safe
 * to switch off — flipping `story_purchase_config.native_link_out` removes a
 * shortcut, not the product.
 *
 * WHY NOT IN THE APP. A Story is digital content consumed in the app, and
 * Google Play requires Play Billing for that. ONIQ's position is that the app
 * never takes the payment; the website does, on the same Razorpay rail the food
 * orders use.
 *
 * THE PRICES RENDERED HERE ARE NOT THE PRICES CHARGED. This reads PRICE_TIERS
 * from the bundle so the chart paints without a round trip; the amount is
 * computed by `create_story_purchase` from `story_price_tiers`. The two are
 * pinned together by storyPricingSql.test.ts, because a page that says ₹99 over
 * a ₹49 charge is the worst kind of pricing bug — nothing errors.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { moneyIn } from "@/lib/format";
import { type PurchaseConfig, buyStorySeconds } from "@/lib/storyCheckout";
import { PRICE_TIERS } from "@/lib/storyPricing";

type StorySearch = { seconds?: number };

export const Route = createFileRoute("/pay/story")({
  validateSearch: (s: Record<string, unknown>): StorySearch => {
    const n = Number(s.seconds);
    // Only a length that is actually a tier survives. An arbitrary number in
    // the query string must not preselect something unpurchasable, and the
    // server would refuse it anyway — better to ignore it here than to render a
    // selection that cannot be paid for.
    return PRICE_TIERS.some((t) => t.seconds === n) ? { seconds: n } : {};
  },
  head: () => ({
    meta: [
      { title: "Buy Story time — ONIQ" },
      {
        name: "description",
        content:
          "Buy time for ONIQ Stories — AI-generated short films made from your own prompt. Pay by UPI, card or netbanking.",
      },
      { property: "og:title", content: "Buy Story time — ONIQ" },
    ],
  }),
  component: PayStoryPage,
});

/** What story_quota_status returns, narrowed to what this page needs. */
type Balance = {
  paidSeconds: number;
  remaining: number;
  purchaseEnabled: boolean;
  nativeLinkOut: boolean;
  checkoutUrl: string | null;
};

function readBalance(payload: unknown): Balance | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  return {
    paidSeconds: num("paidSeconds"),
    remaining: num("remaining"),
    purchaseEnabled: p.purchaseEnabled === true,
    nativeLinkOut: p.nativeLinkOut === true,
    checkoutUrl: typeof p.checkoutUrl === "string" ? p.checkoutUrl : null,
  };
}

function PayStoryPage() {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker
  // here; three violations reached production on 2026-08-04 with tsc clean and
  // the tests green. There are no early returns in this component.
  const search = Route.useSearch();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [chosen, setChosen] = useState<number>(search.seconds ?? 60);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user ?? null;
    setSignedIn(!!user);
    if (!user) {
      setBalance(null);
      return;
    }
    const client = supabase as unknown as {
      rpc: (n: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: q } = await client.rpc("story_quota_status");
    setBalance(readBalance(q));
  }, []);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void refresh());
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const cfg: PurchaseConfig = useMemo(
    () => ({
      purchaseEnabled: balance?.purchaseEnabled ?? false,
      nativeLinkOut: balance?.nativeLinkOut ?? false,
      checkoutUrl: balance?.checkoutUrl ?? null,
    }),
    [balance],
  );

  const buy = useCallback(
    async (seconds: number) => {
      setBusy(true);
      try {
        // `native: false` is stated rather than detected. This page IS the web
        // surface — if it is somehow being rendered inside the native shell,
        // the handoff has already happened and bouncing to a browser again
        // would loop.
        const result = await buyStorySeconds({ seconds, cfg, native: false });
        if (result.status === "paid") {
          toast.success(`${result.seconds}s of Story time added.`);
          await refresh();
        } else if (result.status === "failed") {
          toast.error(result.message);
        }
        // "dismissed" says nothing: the user changed their mind, which is not an
        // error and should not be reported as one.
      } finally {
        setBusy(false);
      }
    },
    [cfg, refresh],
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Buy Story time</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Stories are short films generated from your prompt — pictures, narration and camera
        movement, made by AI. Time is measured in seconds of finished video and never expires.
      </p>

      {signedIn === false ? (
        <div className="mt-6 rounded-lg border p-4">
          <p className="text-sm">Sign in to buy Story time — it is added to your account.</p>
          <Button asChild className="mt-3">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      ) : null}

      {balance ? (
        <p className="mt-6 text-sm">
          You have <strong>{balance.paidSeconds}s</strong> of purchased time
          {balance.remaining > 0 ? ` and ${balance.remaining}s of free time` : ""}.
        </p>
      ) : null}

      <ul className="mt-6 grid gap-3">
        {PRICE_TIERS.map((tier) => {
          const perMinute = Math.round((tier.pricePaise / tier.seconds) * 60);
          return (
            <li
              key={tier.seconds}
              className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${
                chosen === tier.seconds ? "border-primary" : ""
              }`}
            >
              <div>
                <p className="font-medium">{tier.label}</p>
                <p className="text-xs text-muted-foreground">
                  {moneyIn(perMinute / 100, "INR")} per minute
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{moneyIn(tier.pricePaise / 100, "INR")}</span>
                <Button
                  size="sm"
                  disabled={busy || !signedIn || !cfg.purchaseEnabled}
                  onClick={() => {
                    setChosen(tier.seconds);
                    void buy(tier.seconds);
                  }}
                >
                  Buy
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {signedIn && !cfg.purchaseEnabled ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Buying Story time is paused right now. Try again later.
        </p>
      ) : null}

      <p className="mt-8 text-xs text-muted-foreground">
        Payments are handled by Razorpay. Prices include applicable taxes. Story time is
        non-transferable; if a Story fails to generate, its time is returned to your balance
        automatically. See our <Link to="/terms">terms</Link> and{" "}
        <Link to="/privacy">privacy policy</Link>.
      </p>
    </main>
  );
}
