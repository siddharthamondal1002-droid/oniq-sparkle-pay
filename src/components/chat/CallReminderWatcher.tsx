// Polls call_reminders every 30s; surfaces due reminders as a toast. Also
// remembers whether the user has ever missed a call, used by the FSI prompt.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

export function CallReminderWatcher() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid || cancelled) return;
      const { data, error } = await supabase
        .from("call_reminders" as never)
        .select("id, conversation_id, peer_name, remind_at")
        .is("dismissed_at", null)
        .lte("remind_at", new Date().toISOString())
        .limit(5);
      if (error || !data) return;
      for (const r of data as Array<{ id: string; conversation_id: string; peer_name: string | null }>) {
        toast(`Reminder: call ${r.peer_name || "them"} back`, {
          duration: 8000,
          action: {
            label: "Call",
            onClick: () => {
              navigate({
                to: "/app/chat/$conversationId" as never,
                params: { conversationId: r.conversation_id } as never,
              }).catch(() => {});
            },
          },
        });
        await supabase
          .from("call_reminders" as never)
          .update({ dismissed_at: new Date().toISOString() } as never)
          .eq("id", r.id);
      }
    }

    tick();
    timer = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [navigate]);
  return null;
}
