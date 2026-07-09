import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Shield, X } from "lucide-react";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function PolicyNoticeBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("last_policy_notice_at")
        .eq("id", u.user.id)
        .maybeSingle();
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
    <div className="fixed left-1/2 top-2 z-40 w-full max-w-md -translate-x-1/2 px-3">
      <div className="flex items-start gap-2 rounded-2xl border border-primary/40 bg-primary/10 p-3 text-xs shadow-lg backdrop-blur">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1">
          <div className="font-semibold">How ONIQ keeps chats safe</div>
          <Link to="/terms" onClick={dismiss} className="text-primary hover:underline">
            Our rules & how to report →
          </Link>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/10">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
