import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Shield } from "lucide-react";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Quarterly safety notice — a centered pop-up (was a persistent top banner).
 * Shows once per 90 days; "Got it" records the acknowledgement.
 */
export function PolicyNoticeBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: p, error } = await supabase
        .from("profiles")
        .select("last_policy_notice_at")
        .eq("id", u.user.id)
        .maybeSingle();
      // If the read itself fails, stay quiet rather than nagging forever.
      if (error) return;
      const last = p?.last_policy_notice_at ? new Date(p.last_policy_notice_at).getTime() : 0;
      if (!last || Date.now() - last > NINETY_DAYS_MS) setShow(true);
    })();
  }, []);

  const dismiss = async () => {
    setShow(false);
    await supabase.rpc("mark_policy_notice_seen");
  };

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm" onClick={dismiss}>
      <div
        className="w-full max-w-sm rounded-3xl border border-primary/40 bg-card p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/15">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <h3 className="font-display text-base font-semibold">How ONIQ keeps chats safe</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Zero tolerance for harassment, impersonation, and non-consensual content.
          Report anything off from any post, reel, or chat — serious reports are
          acted on within 36 hours.
        </p>
        <Link
          to="/terms"
          onClick={dismiss}
          className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
        >
          Our rules & how to report →
        </Link>
        <button
          onClick={dismiss}
          className="press mt-4 w-full rounded-2xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Got it 👍
        </button>
      </div>
    </div>
  );
}
