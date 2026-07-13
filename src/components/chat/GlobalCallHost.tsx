// Global CallOverlay host mounted once at the authenticated layout root.
// The per-conversation route no longer mounts CallOverlay; instead it
// dispatches `oniq:start-call` events which this host listens to and turns
// into a mounted CallOverlay. Navigation between routes does not unmount
// the call because the host lives above the routed <Outlet />.
//
// Events:
// - `oniq:start-call` { conversationId, callType, peerName, isGroup?, groupTitle?, meId, meName }
// - `oniq:accept-call` { callId, callType, conversationId } — from GlobalIncomingCall
// The host uses the event to mount CallOverlay with autoStart/autoAccept
// props; CallOverlay's internal signaling/PeerPool logic is unchanged.

import { useEffect, useState } from "react";
import { CallOverlay, type CallType } from "./CallOverlay";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type StartDetail = {
  conversationId: string;
  callType: CallType;
  peerName: string;
  isGroup?: boolean;
  groupTitle?: string;
  meId?: string;
  meName?: string;
};

type AcceptDetail = {
  callId: string;
  callType: CallType;
  conversationId: string;
};

type Session =
  | { kind: "start"; nonce: string; detail: StartDetail }
  | { kind: "accept"; nonce: string; detail: AcceptDetail & { peerName?: string; isGroup?: boolean; groupTitle?: string; meName?: string; meId?: string } };

export function GlobalCallHost() {
  const [session, setSession] = useState<Session | null>(null);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });
  const meName =
    (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)?.display_name ||
    (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)?.full_name ||
    me?.email ||
    "Someone";

  useEffect(() => {
    const onStart = (e: Event) => {
      const d = (e as CustomEvent).detail as StartDetail | undefined;
      if (!d?.conversationId || !d?.callType) return;
      setSession({
        kind: "start",
        nonce: `${d.conversationId}:${Date.now()}`,
        detail: { ...d, meId: d.meId ?? me?.id, meName: d.meName ?? meName },
      });
    };
    const onAccept = async (e: Event) => {
      const d = (e as CustomEvent).detail as AcceptDetail | undefined;
      if (!d?.callId || !d?.conversationId) return;
      // Look up a friendly peer name for the mounted overlay.
      let peerName = "Someone";
      try {
        const { data: rows } = await supabase
          .from("conversation_members")
          .select("user_id, profiles(display_name, username)")
          .eq("conversation_id", d.conversationId)
          .neq("user_id", me?.id ?? "");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const first = (rows ?? [])[0] as any;
        if (first) {
          peerName = first.profiles?.display_name || first.profiles?.username || peerName;
        }
      } catch { /* ignore */ }
      setSession({
        kind: "accept",
        nonce: `${d.conversationId}:${d.callId}`,
        detail: { ...d, peerName, meId: me?.id, meName },
      });
    };
    window.addEventListener("oniq:start-call", onStart as EventListener);
    window.addEventListener("oniq:accept-call", onAccept as EventListener);
    return () => {
      window.removeEventListener("oniq:start-call", onStart as EventListener);
      window.removeEventListener("oniq:accept-call", onAccept as EventListener);
    };
  }, [me?.id, meName]);

  if (!session) return null;

  if (session.kind === "start") {
    const d = session.detail;
    return (
      <CallOverlay
        key={session.nonce}
        conversationId={d.conversationId}
        meId={d.meId}
        meName={d.meName ?? "Someone"}
        peerName={d.peerName}
        isGroup={d.isGroup}
        groupTitle={d.groupTitle}
        autoStart={d.callType}
        onEnded={() => setSession(null)}
      />
    );
  }

  const d = session.detail;
  return (
    <CallOverlay
      key={session.nonce}
      conversationId={d.conversationId}
      meId={d.meId}
      meName={d.meName ?? "Someone"}
      peerName={d.peerName ?? "Someone"}
      isGroup={d.isGroup}
      groupTitle={d.groupTitle}
      autoAccept={{ callId: d.callId, callType: d.callType }}
      onEnded={() => setSession(null)}
    />
  );
}
