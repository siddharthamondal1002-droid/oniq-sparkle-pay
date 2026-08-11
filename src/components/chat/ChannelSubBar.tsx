/**
 * The subscription strip a channel wears under its header.
 *
 * TWO FACES. A member sees the offer — "Support this channel, ₹X/month" —
 * and tapping it goes to /pay/subscribe: in this tab on the web, via the
 * system browser on native, the same link-out posture as Story time and for
 * the same Play Billing reason. The OWNER sees their shop: current price,
 * a bounded editor, and what subscribers have paid them so far (their 70%
 * share, summed from the receipts they can already read under RLS).
 *
 * The strip renders nothing at all for channels that never set a price —
 * subscriptions are opt-in per channel, not a default ask.
 */
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { BadgeCheck, IndianRupee, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPaise } from "@/lib/storyPricing";

type Cfg = { price_paise: number; currency: string; enabled: boolean };

export function ChannelSubBar({
  conversationId,
  isOwner,
}: {
  conversationId: string;
  isOwner: boolean;
}) {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker.
  const [cfg, setCfg] = useState<Cfg | null | undefined>(undefined); // undefined = loading
  const [activeUntil, setActiveUntil] = useState<string | null>(null);
  const [earnedPaise, setEarnedPaise] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: me } = await supabase.auth.getUser();
      const uid = me.user?.id;
      const [cfgRes, subRes] = await Promise.all([
        supabase
          .from("channel_sub_config" as never)
          .select("price_paise,currency,enabled")
          .eq("channel_id" as never, conversationId as never)
          .maybeSingle(),
        uid
          ? supabase
              .from("channel_subscriptions" as never)
              .select("period_end")
              .eq("channel_id" as never, conversationId as never)
              .eq("subscriber_id" as never, uid as never)
              .eq("status" as never, "active" as never)
              .order("period_end" as never, { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      setCfg((cfgRes.data as Cfg | null) ?? null);
      const until = (subRes.data as { period_end?: string } | null)?.period_end ?? null;
      setActiveUntil(until && new Date(until) > new Date() ? until : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // The owner's till: their share of every active receipt for this channel.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void supabase
      .from("channel_subscriptions" as never)
      .select("creator_paise")
      .eq("channel_id" as never, conversationId as never)
      .eq("status" as never, "active" as never)
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        setEarnedPaise(
          (data as { creator_paise: number | null }[]).reduce(
            (sum, r) => sum + (r.creator_paise ?? 0),
            0,
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, conversationId]);

  const savePrice = async () => {
    const rupees = Number(priceInput);
    if (!Number.isFinite(rupees) || rupees < 10 || rupees > 10000) {
      toast.error(`Price must be ${formatPaise(1000)}–${formatPaise(1000000)} a month`);
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc(
        "set_channel_sub_price" as never,
        {
          _channel_id: conversationId,
          _price_paise: Math.round(rupees * 100),
          _enabled: true,
        } as never,
      );
      const out = data as { ok?: boolean; reason?: string } | null;
      if (error || !out?.ok) {
        toast.error(out?.reason === "not-your-channel" ? "Not your channel" : "Couldn't save");
        return;
      }
      setCfg({ price_paise: Math.round(rupees * 100), currency: "INR", enabled: true });
      setEditing(false);
      toast.success("Subscription price set 💸");
    } finally {
      setSaving(false);
    }
  };

  const subscribe = () => {
    const url = `/pay/subscribe?channel=${conversationId}${Capacitor.isNativePlatform() ? "&from=app" : ""}`;
    if (Capacitor.isNativePlatform()) {
      // System browser, not the WebView: the app must not collect the money.
      window.open(`https://oniqhub.com${url}`, "_blank", "noopener");
    } else {
      window.location.assign(url);
    }
  };

  if (cfg === undefined) return null;
  if (!isOwner && !cfg) return null;

  return (
    <div className="border-b border-border/60 bg-card/60 px-3 py-2">
      {isOwner ? (
        editing ? (
          <div className="flex items-center gap-2">
            <IndianRupee className="h-3.5 w-3.5 shrink-0 text-primary" />
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 99"
              className="w-24 rounded-lg border border-border bg-input/40 px-2 py-1 text-xs focus:border-primary focus:outline-none"
            />
            <span className="text-[11px] text-muted-foreground">/month</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void savePrice()}
              className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[11px] text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setPriceInput(cfg ? String(Math.round(cfg.price_paise / 100)) : "");
              setEditing(true);
            }}
            className="flex w-full items-center justify-between normal-case tracking-normal"
          >
            <span className="text-[11px] text-muted-foreground">
              {cfg
                ? `Subscriptions: ${formatPaise(cfg.price_paise, cfg.currency)}/month`
                : "Set a subscription price for this channel"}
              {earnedPaise !== null && earnedPaise > 0
                ? ` · earned ${formatPaise(earnedPaise, "INR")}`
                : ""}
            </span>
            <span className="text-[11px] font-semibold text-primary">
              {cfg ? "Edit" : "Set up"}
            </span>
          </button>
        )
      ) : activeUntil ? (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
          <BadgeCheck className="h-3.5 w-3.5" />
          Subscribed · renews by choice · until{" "}
          {new Date(activeUntil).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </div>
      ) : cfg && cfg.enabled ? (
        <button
          type="button"
          onClick={subscribe}
          className="flex w-full items-center justify-between normal-case tracking-normal"
        >
          <span className="text-[11px] text-muted-foreground">
            Support this channel — {formatPaise(cfg.price_paise, cfg.currency)}/month, with cashback
            to your wallet
          </span>
          <span className="text-[11px] font-semibold text-primary">Subscribe</span>
        </button>
      ) : null}
    </div>
  );
}
