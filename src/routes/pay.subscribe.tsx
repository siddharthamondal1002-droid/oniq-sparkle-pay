/**
 * /pay/subscribe — where a channel subscription is actually sold.
 *
 * SAME POLICY PAGE AS /pay/story, THIRD PRODUCT. A subscription is digital
 * content consumed in the app, so the app never collects the money: the
 * native build opens THIS page in the system browser, the browser runs
 * Razorpay, and the membership appears in the same channel the app reads.
 * `?from=app` marks the handoff for provenance (origin=native-handoff on the
 * receipt), never authorisation.
 *
 * THE PRICE ON THIS PAGE COMES FROM THE DATABASE — channel_sub_config, the
 * row only the channel owner can write, through a bounded RPC. The browser
 * names a CHANNEL; razorpay-order prices it server-side.
 *
 * WHERE THE MONEY GOES is printed on the page, because a split nobody can
 * see breeds support tickets: the creator's share, ONIQ's share, and the
 * subscriber's cashback — read live from channel_sub_split_config, the same
 * row credit_channel_subscription applies.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { payForChannelSub } from "@/lib/razorpay";
import { formatPaise } from "@/lib/storyPricing";

export const Route = createFileRoute("/pay/subscribe")({
  validateSearch: (search: Record<string, unknown>): { channel?: string; from?: string } => ({
    channel: typeof search.channel === "string" ? search.channel : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Subscribe — ONIQ" },
      { name: "description", content: "Support a creator's channel on ONIQ." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PaySubscribePage,
});

type ChannelInfo = {
  name: string;
  pricePaise: number;
  currency: string;
  enabled: boolean;
};

type Split = { creator_pct: number; oniq_pct: number; cashback_pct: number };

function PaySubscribePage() {
  // EVERY HOOK ABOVE EVERY EARLY RETURN — rules-of-hooks is a release blocker
  // in this repo. There are no early returns; the branching lives in the JSX.
  const { channel, from } = Route.useSearch();
  const fromApp = from === "app";

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!channel || !signedIn) return;
    let cancelled = false;
    void (async () => {
      const [cfgRes, chanRes, splitRes] = await Promise.all([
        supabase
          .from("channel_sub_config" as never)
          .select("price_paise,currency,enabled")
          .eq("channel_id" as never, channel as never)
          .maybeSingle(),
        supabase.from("conversations").select("name").eq("id", channel).maybeSingle(),
        supabase
          .from("channel_sub_split_config" as never)
          .select("creator_pct,oniq_pct,cashback_pct")
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const cfg = cfgRes.data as { price_paise: number; currency: string; enabled: boolean } | null;
      const chan = chanRes.data as { name: string | null } | null;
      if (cfgRes.error || !cfg) {
        setLoadError("That channel is not selling subscriptions.");
        return;
      }
      setInfo({
        name: chan?.name ?? "Channel",
        pricePaise: cfg.price_paise,
        currency: cfg.currency,
        enabled: cfg.enabled,
      });
      if (!splitRes.error && splitRes.data) setSplit(splitRes.data as unknown as Split);
    })();
    return () => {
      cancelled = true;
    };
  }, [channel, signedIn]);

  const buy = async () => {
    if (!channel || buying) return;
    setBuying(true);
    setPayError(null);
    try {
      const out = await payForChannelSub({
        channelId: channel,
        origin: fromApp ? "native-handoff" : "web",
      });
      if (out.status === "paid") setPaid(true);
      else if (out.status === "failed") setPayError(out.message);
      // dismissed ends quietly — the user saw the sheet and chose.
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary/80">
        <Users className="h-3.5 w-3.5" /> ONIQ channels
      </div>
      <h1 className="mt-1 font-display text-2xl font-bold text-foreground">
        {info ? info.name : "Subscribe"}
      </h1>

      {!channel ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This page needs a channel. Open it from a channel inside ONIQ.
        </p>
      ) : signedIn === null ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : !signedIn ? (
        <div className="mt-6 rounded-2xl border border-border bg-card/70 p-4">
          <p className="text-sm text-foreground">Sign in to subscribe.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the same account you use in the app —{" "}
            <a href="/auth" target="_blank" rel="noreferrer" className="text-primary underline">
              sign in here
            </a>{" "}
            and come back; this page notices by itself.
          </p>
        </div>
      ) : paid ? (
        <div className="mt-6 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <BadgeCheck className="h-4 w-4" /> You're subscribed 🎉
          </div>
          <p className="mt-1.5 text-xs text-emerald-200/80">
            A month of {info?.name ?? "the channel"} is yours
            {split && split.cashback_pct > 0
              ? `, and ${split.cashback_pct}% just landed back in your ONIQ wallet as cashback`
              : ""}
            . {fromApp ? "Head back to the ONIQ app — the channel is already open to you." : ""}
          </p>
          {!fromApp && (
            <Link to="/app/chat" className="mt-3 inline-block text-xs text-primary underline">
              Open ONIQ
            </Link>
          )}
        </div>
      ) : loadError ? (
        <p className="mt-6 text-sm text-destructive">{loadError}</p>
      ) : !info ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-foreground">One month</span>
              <span className="font-display text-xl font-bold text-foreground">
                {formatPaise(info.pricePaise, info.currency)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Renews only when you choose to — no auto-charge. Each payment adds thirty days.
            </p>
            {split && (
              <p className="mt-2 rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                Where it goes: {split.creator_pct}% to the creator, {split.oniq_pct}% to ONIQ,{" "}
                {split.cashback_pct}% back to you as wallet cashback.
              </p>
            )}
          </div>
          {!info.enabled && (
            <p className="mt-3 text-xs text-amber-300">
              Subscriptions are paused for this channel right now.
            </p>
          )}
          {payError && <p className="mt-3 text-xs text-destructive">{payError}</p>}
          <button
            type="button"
            onClick={() => void buy()}
            disabled={buying || !info.enabled}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {buying
              ? "Opening checkout…"
              : `Subscribe — ${formatPaise(info.pricePaise, info.currency)}`}
          </button>
          <p className="mt-3 text-center text-[10px] text-muted-foreground">
            Payments are processed by Razorpay and confirmed server-side before anything is
            credited.
          </p>
        </>
      )}
    </div>
  );
}
