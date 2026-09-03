import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertCircle,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  RotateCw,
  Video,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { CALLS_ENABLED } from "@/lib/flags";
import { OniqCanvas, OniqCard, OniqEmpty, OniqHeader, OniqSectionHeader } from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/chat/calls")({
  component: CallsRouteGate,
});

function CallsRouteGate() {
  if (!CALLS_ENABLED) {
    return (
      <OniqCanvas world="chat" className="pb-4">
        <OniqHeader eyebrow="Chat" title="Calls" back="/app/chat" />
        <div className="mt-6 px-5">
          <OniqEmpty emoji="📞" title="calls are coming soon 📞" />
        </div>
      </OniqCanvas>
    );
  }
  return <CallsTab />;
}

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

type ProfileLite = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

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
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-world-soft font-semibold text-world">
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
}

function CallsTab() {
  const navigate = useNavigate();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const {
    data: logs = [],
    isError: logsError,
    refetch,
  } = useQuery({
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

  // Conversations we need to hydrate members for (fallback when callee_ids empty).
  const emptyConvIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of logs) {
      if ((!l.callee_ids || l.callee_ids.length === 0) && l.conversation_id)
        s.add(l.conversation_id);
    }
    return [...s];
  }, [logs]);

  const { data: convMembers = [] } = useQuery({
    queryKey: ["call-log-conv-members", emptyConvIds.join(",")],
    enabled: emptyConvIds.length > 0,
    queryFn: async (): Promise<{ conversation_id: string; user_id: string }[]> => {
      const { data } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", emptyConvIds);
      return (data ?? []) as { conversation_id: string; user_id: string }[];
    },
  });
  const convMemberMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of convMembers) {
      const arr = m.get(r.conversation_id) ?? [];
      arr.push(r.user_id);
      m.set(r.conversation_id, arr);
    }
    return m;
  }, [convMembers]);

  // Peer IDs to hydrate (the other party for each log).
  const peerIds = useMemo(() => {
    if (!me) return [];
    const set = new Set<string>();
    for (const l of logs) {
      if (l.caller_id !== me.id) set.add(l.caller_id);
      const callees =
        l.callee_ids && l.callee_ids.length > 0
          ? l.callee_ids
          : (convMemberMap.get(l.conversation_id) ?? []);
      for (const c of callees) if (c !== me.id) set.add(c);
    }
    return [...set];
  }, [logs, me, convMemberMap]);

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

  /**
   * Call back = dispatch `oniq:start-call`, the same event the thread's own
   * call buttons fire. This used to navigate with `?startCall=…`, a parameter
   * only ever read inside CallOverlay's subscribe callback — and since the
   * GlobalCallHost refactor the thread route mounts no CallOverlay, so nobody
   * read it and tapping a history entry just opened the chat. Navigation
   * still happens (the user should land in the conversation), but the call
   * no longer depends on it.
   */
  const callBack = (conversationId: string, callType: "audio" | "video", peerName: string) => {
    const meName =
      (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)
        ?.display_name ||
      (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)?.full_name ||
      me?.email ||
      "Someone";
    window.dispatchEvent(
      new CustomEvent("oniq:start-call", {
        detail: { conversationId, callType, peerName, meId: me?.id, meName },
      }),
    );
    navigate({
      to: "/app/chat/$conversationId" as const,
      params: { conversationId },
    });
  };

  const goToConversation = (conversationId: string) => {
    navigate({
      to: "/app/chat/$conversationId" as const,
      params: { conversationId },
    });
  };

  return (
    <OniqCanvas world="chat" className="pb-4">
      <OniqHeader
        eyebrow="Chat"
        title="Calls"
        subtitle="Recent calls. Tap the handset to call back."
        back="/app/chat"
      />

      {logsError ? (
        <div className="mt-5 px-5">
          <div role="alert" className="rise rounded-3xl oniq-surface p-4 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-amber-500" />
              <span>Couldn't load your call history — a connection problem, not an empty log.</span>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="press mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        </div>
      ) : logs.length === 0 ? (
        <div className="mt-5 px-5">
          <OniqEmpty
            className="rise"
            emoji="📞"
            title="No calls yet"
            body="Start one from any chat 📞"
          />
        </div>
      ) : (
        <section className="mt-5 rise rise-1">
          <OniqSectionHeader eyebrow="History" title="Recent" />
          <div className="mt-3 px-5">
            <OniqCard padding="none" className="overflow-hidden">
              <ul className="divide-y divide-border/60">
                {logs.map((l) => {
                  const outgoing = me?.id === l.caller_id;
                  const effectiveCallees =
                    l.callee_ids && l.callee_ids.length > 0
                      ? l.callee_ids
                      : (convMemberMap.get(l.conversation_id) ?? []).filter(
                          (u) => u !== l.caller_id,
                        );
                  const peerId = outgoing ? (effectiveCallees[0] ?? "") : l.caller_id;
                  const peer = profMap.get(peerId);

                  const peerName = peer?.display_name || peer?.username || "Someone";
                  const missed =
                    l.status === "missed" ||
                    l.status === "no_answer" ||
                    (!outgoing && l.status === "declined");
                  const Icon = l.call_type === "video" ? Video : Phone;
                  const Arrow =
                    missed && !outgoing ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
                  const arrowClass = missed
                    ? "text-destructive"
                    : outgoing
                      ? "text-muted-foreground"
                      : "text-emerald-500";
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => goToConversation(l.conversation_id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-surface-2"
                      >
                        <AvatarCircle name={peerName} url={peer?.avatar_url ?? null} />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`truncate text-[15px] font-semibold ${
                              missed && !outgoing ? "text-destructive" : "text-foreground"
                            }`}
                          >
                            {peerName}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Arrow className={`h-3.5 w-3.5 ${arrowClass}`} />
                            <span className="capitalize">
                              {outgoing
                                ? "Outgoing"
                                : l.status === "missed" || l.status === "no_answer"
                                  ? "Missed"
                                  : "Incoming"}
                            </span>
                            <span>·</span>
                            <span>{timeLabel(l.created_at)}</span>
                            {l.status === "answered" && l.duration_s ? (
                              <>
                                <span>·</span>
                                <span>{durLabel(l.duration_s)}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            callBack(l.conversation_id, l.call_type, peerName);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              callBack(l.conversation_id, l.call_type, peerName);
                            }
                          }}
                          className="tap press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-world-soft text-world"
                          aria-label={`Call back ${peerName}`}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </OniqCard>
          </div>
        </section>
      )}
    </OniqCanvas>
  );
}
