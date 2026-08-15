/**
 * /pay/story — where Story time is actually sold.
 *
 * THIS PAGE IS THE POLICY, not just a screen. Story time is digital content
 * consumed in the app, and ONIQ's answer to Play's billing rule is that the
 * app never collects the money: the native build opens THIS page in the system
 * browser (`checkoutTarget` decides that), the browser runs Razorpay, and the
 * seconds appear in the same allowance the app reads. That is why this route
 * lives outside `_authenticated/` — it must work in a browser that has never
 * seen the app shell — and why it exists at the exact URL
 * `story_purchase_config.checkout_url` names.
 *
 * `?from=app` marks the native handoff. It changes two things: the copy tells
 * the user to go back to the app when they are done, and the purchase row is
 * recorded with origin=native-handoff. PROVENANCE, NOT AUTHORISATION — the
 * server prices and verifies identically either way; the marker exists so a
 * payment claiming to come from inside the app is visible rather than assumed.
 *
 * PRICES ON THIS PAGE COME FROM THE DATABASE, not the bundle. A price
 * correction is an UPDATE to `story_price_tiers`, live immediately — showing
 * the bundled copy here would undo exactly that property. The bundled
 * PRICE_TIERS is a shape for tests and skeletons; the row the user taps is the
 * row the server will charge.
 *
 * SIGN-IN IS HANDLED IN PLACE rather than by redirect. A native-handoff user
 * very likely has no web session. /auth returns to /app, which would strand
 * them; instead the sign-in link opens in a new tab and this page listens for
 * the session — supabase-js broadcasts auth changes across tabs — and flips to
 * the price chart the moment it arrives.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Clapperboard, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { payForStorySeconds, payForWatermarkRemoval } from "@/lib/razorpay";
import { formatPaise } from "@/lib/storyPricing";

type Tier = { seconds: number; label: string; price_paise: number; currency: string };

export const Route = createFileRoute("/pay/story")({
  validateSearch: (search: Record<string, unknown>): { from?: string; wm?: string } => ({
    from: typeof search.from === "string" ? search.from : undefined,
    // A Story job id: this visit is buying the flat watermark-removal addon
    // for that video rather than Story time.
    wm: typeof search.wm === "string" && /^[0-9a-f-]{36}$/i.test(search.wm) ? search.wm : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Buy Story time — ONIQ" },
      {
        name: "description",
        content: "Top up your ONIQ Story time. Pay on the web, use it in the app.",
      },
      // A checkout page has no business in a search index.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PayStoryPage,
});

function PayStoryPage() {
  // EVERY HOOK ABOVE EVERY EARLY RETURN — rules-of-hooks is a release blocker
  // in this repo. There are no early returns in this component; the branching
  // lives in the JSX below.
  const { from, wm } = Route.useSearch();
  const fromApp = from === "app";

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [selling, setSelling] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paidBalance, setPaidBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [credited, setCredited] = useState<number | null>(null);
  const [wmPrice, setWmPrice] = useState<{ label: string; price_paise: number } | null>(null);
  const [wmBuying, setWmBuying] = useState(false);
  const [wmDone, setWmDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.session);
    });
    // Cross-tab: the sign-in link opens /auth in a new tab, and this fires
    // here when that tab finishes. The page heals itself without a reload.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [tierRes, cfgRes] = await Promise.all([
        supabase
          .from("story_price_tiers")
          .select("seconds,label,price_paise,currency")
          .eq("active", true)
          // MOVIE, NOT CLASSIC. This asked for classic while classic was off
          // sale, so it matched nothing and the page showed "Could not load
          // the price list" — Story time had been unbuyable since the
          // 2026-08-13 flip. Classic is now withdrawn outright (owner
          // directive, 2026-08-15) and movie is the only grade there is.
          .eq("grade" as never, "movie" as never)
          .order("sort_order"),
        supabase.from("story_purchase_config").select("enabled").limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      if (tierRes.error || !tierRes.data?.length) {
        setLoadError("Could not load the price list. Refresh to try again.");
      } else {
        setTiers(tierRes.data);
      }
      // A missing config row reads as selling — razorpay-order is the
      // enforcement; this flag only chooses between the chart and the notice.
      if (!cfgRes.error && cfgRes.data) setSelling(cfgRes.data.enabled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The paid balance, so the page can show the credit actually landing. */
  const refreshBalance = useCallback(async () => {
    const { data, error } = await supabase.rpc("story_quota_status");
    if (error) return;
    const paid = (data as { paidSeconds?: number } | null)?.paidSeconds;
    if (typeof paid === "number") setPaidBalance(paid);
  }, []);

  useEffect(() => {
    if (signedIn) void refreshBalance();
  }, [signedIn, refreshBalance]);

  // Watermark mode: the visit names a job, so show the flat addon instead of
  // the time chart. Price from the database, like everything on this page.
  useEffect(() => {
    if (!wm) return;
    let cancelled = false;
    void supabase
      .from("story_addons" as never)
      .select("label, price_paise")
      .eq("key" as never, "watermark_removal" as never)
      .eq("active" as never, true as never)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data)
          setWmPrice(data as unknown as { label: string; price_paise: number });
      });
    return () => {
      cancelled = true;
    };
  }, [wm]);

  const buyWatermark = useCallback(async () => {
    if (!wm) return;
    setWmBuying(true);
    setPayError(null);
    try {
      const result = await payForWatermarkRemoval({ jobId: wm });
      if (result.status === "paid") setWmDone(true);
      else if (result.status === "failed") setPayError(result.message);
    } finally {
      setWmBuying(false);
    }
  }, [wm]);

  const buy = useCallback(
    async (seconds: number) => {
      setBuying(seconds);
      setPayError(null);
      setCredited(null);
      try {
        const result = await payForStorySeconds({
          seconds,
          origin: fromApp ? "native-handoff" : "web",
        });
        if (result.status === "paid") {
          setCredited(result.seconds);
          // Read the balance back rather than adding locally — the credit is
          // the webhook/verify's write, and showing OUR arithmetic here would
          // paper over the one failure worth seeing.
          void refreshBalance();
        } else if (result.status === "failed") {
          setPayError(result.message);
        }
        // Dismissed: they changed their mind. The chart is still right there.
      } finally {
        setBuying(null);
      }
    },
    [fromApp, refreshBalance],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="flex items-center gap-2 text-primary">
          <Clapperboard className="h-6 w-6" />
          <span className="font-display text-lg font-bold">ONIQ Stories</span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold">Buy Story time</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Seconds of AI-generated video, added to your Story balance. Paid time never expires and is
          not limited by the daily free allowance.
        </p>

        {credited !== null ? (
          <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/10 p-4">
            <div className="flex items-center gap-2 font-semibold text-primary">
              <Check className="h-5 w-5" /> {credited} seconds added
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {fromApp
                ? "You're done here — head back to the ONIQ app. Your new balance is already there."
                : "Your new balance is ready wherever you use ONIQ."}
              {typeof paidBalance === "number" ? (
                <span className="mt-1 block">
                  Purchased time now: <span className="font-semibold">{paidBalance}s</span>
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        {!selling ? (
          <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Buying Story time is paused right now. Your existing balance is unaffected — try again
            later.
          </div>
        ) : signedIn === false ? (
          <div className="mt-6 rounded-2xl border border-border bg-card p-4">
            <div className="text-sm font-semibold">Sign in to continue</div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use the same account you use in the ONIQ app, so the time lands in the right balance.
              Sign in opens in a new tab — this page will notice by itself.
            </p>
            <a
              href="/auth"
              target="_blank"
              rel="noopener"
              className="mt-3 inline-block rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Sign in to ONIQ
            </a>
          </div>
        ) : wm ? (
          <div className="mt-6 space-y-2.5">
            {wmDone ? (
              <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4">
                <div className="flex items-center gap-2 font-semibold text-primary">
                  <Check className="h-5 w-5" /> Watermark removed
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  A clean copy of your video is rendering now and will appear in Your videos when
                  it&apos;s done.
                  {fromApp ? " You can head back to the ONIQ app." : ""}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Remove the ONIQ watermark from this video — one flat price, whatever the length. A
                  clean copy is rendered and delivered to Your videos.
                </p>
                <button
                  type="button"
                  disabled={wmBuying || signedIn !== true || !wmPrice}
                  onClick={() => void buyWatermark()}
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary disabled:opacity-50"
                >
                  <span className="text-sm font-semibold">
                    {wmPrice?.label ?? "Remove the ONIQ watermark"}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-primary">
                    {wmBuying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {wmPrice ? formatPaise(wmPrice.price_paise) : "…"}
                  </span>
                </button>
                {payError ? <p className="text-sm text-destructive">{payError}</p> : null}
              </>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-2.5">
            {signedIn && typeof paidBalance === "number" && credited === null ? (
              <p className="text-sm text-muted-foreground">
                Purchased time left: <span className="font-semibold">{paidBalance}s</span>
              </p>
            ) : null}
            {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
            {tiers === null && !loadError ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading prices…
              </div>
            ) : null}
            {(tiers ?? []).map((t) => (
              <button
                key={t.seconds}
                type="button"
                disabled={buying !== null || signedIn !== true}
                onClick={() => void buy(t.seconds)}
                className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary disabled:opacity-50"
              >
                <span className="text-sm font-semibold">{t.label}</span>
                <span className="flex items-center gap-2 text-sm text-primary">
                  {buying === t.seconds ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {formatPaise(t.price_paise, t.currency)}
                </span>
              </button>
            ))}
            {signedIn === null ? (
              <p className="text-xs text-muted-foreground">Checking your session…</p>
            ) : null}
            {payError ? <p className="text-sm text-destructive">{payError}</p> : null}
          </div>
        )}

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          Payments are processed by Razorpay and confirmed server-side before any time is credited.
          The price charged is the one in ONIQ's price list, never one sent by this page.{" "}
          {fromApp ? null : (
            <>
              Manage your videos in the app or at{" "}
              <Link to="/" className="text-primary hover:underline">
                oniqhub.com
              </Link>
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
