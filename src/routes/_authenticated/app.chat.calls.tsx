import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Phone, Video, PhoneMissed, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";

export const Route = createFileRoute("/_authenticated/app/chat/calls")({
  component: CallsTab,
});

type CallRow = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_ids: string[];
  call_type: "audio" | "video";
  status: "missed" | "answered" | "declined" | "no_answer";
  started_at: string;
  duration_s: number | null;
  created_at: string;
};

type ProfileLite = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd MMM");
}

function durLabel(s: number | null): string {
  if (!s || s <= 0) return "";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function AvatarCircle({ name, url }: { name: string; url: string | null }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/20 font-semibold text-primary">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initial}
    </div>
  );
}

function CallsTab() {
  const navigate = useNavigate();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: logs = [], refetch } = useQuery({
    queryKey: ["call-logs", me?.id],
    enabled: !!me,
    staleTime: 15_000,
    queryFn: async (): Promise<CallRow[]> => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as CallRow[];
    },
  });

  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  // Peer IDs to hydrate (the other party for each log).
  const peerIds = useMemo(() => {
    if (!me) return [];
    const set = new Set<string>();
    for (const l of logs) {
      if (l.caller_id !== me.id) set.add(l.caller_id);
      for (const c of l.callee_ids || []) if (c !== me.id) set.add(c);
    }
    return [...set];
  }, [logs, me]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["call-log-profiles", peerIds.join(",")],
    enabled: peerIds.length > 0,
    queryFn: async (): Promise<ProfileLite[]> => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", peerIds);
      return (data ?? []) as ProfileLite[];
    },
  });
  const profMap = useMemo(() => {
    const m = new Map<string, ProfileLite>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const goToConversation = (conversationId: string, callType: "audio" | "video") => {
    navigate({
      to: "/app/chat/$conversationId" as const,
      params: { conversationId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      search: { startCall: callType } as any,
    });
  };

  return (
    <div className="px-4 pt-12 pb-4">
      <div className="flex items-center gap-2 px-1">
        <Link to="/app/chat" aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-3xl font-bold">Calls</h1>
      </div>

      {logs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary">
            <Phone className="h-7 w-7" />
          </div>
          <div className="text-sm">No calls yet — start one from any chat 📞</div>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border/50">
          {logs.map((l) => {
            const outgoing = me?.id === l.caller_id;
            const peerId = outgoing ? (l.callee_ids?.[0] ?? "") : l.caller_id;
            const peer = profMap.get(peerId);
            const peerName = peer?.display_name || peer?.username || "Someone";
            const missed = l.status === "missed" || l.status === "no_answer" || (!outgoing && l.status === "declined");
            const Icon = l.call_type === "video" ? Video : Phone;
            const Arrow = missed && !outgoing ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
            const arrowClass = missed ? "text-destructive" : outgoing ? "text-muted-foreground" : "text-[#25D366]";
            return (
              <li key={l.id}>
                <button
                  onClick={() => goToConversation(l.conversation_id, l.call_type)}
                  className="flex w-full items-center gap-3 px-1 py-3 text-left active:bg-muted/60"
                >
                  <AvatarCircle name={peerName} url={peer?.avatar_url ?? null} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-semibold ${missed && !outgoing ? "text-destructive" : ""}`}>
                      {peerName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Arrow className={`h-3.5 w-3.5 ${arrowClass}`} />
                      <span className="capitalize">{outgoing ? "Outgoing" : l.status === "missed" || l.status === "no_answer" ? "Missed" : "Incoming"}</span>
                      <span>·</span>
                      <span>{timeLabel(l.created_at)}</span>
                      {l.status === "answered" && l.duration_s ? <><span>·</span><span>{durLabel(l.duration_s)}</span></> : null}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); goToConversation(l.conversation_id, l.call_type); }}
                    className="grid h-10 w-10 place-items-center rounded-full text-primary hover:bg-primary/10"
                    aria-label={`Call back ${peerName}`}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
