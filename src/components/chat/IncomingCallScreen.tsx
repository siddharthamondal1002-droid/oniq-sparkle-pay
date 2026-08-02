// Full-screen incoming call UI. Purely presentational — parent
// (GlobalIncomingCall) owns subscription, sound lifecycle, accept/decline
// side-effects. This component only:
//   - renders the visuals (avatar, pulse, gradient, group stack)
//   - captures swipe-up-to-answer
//   - exposes Message / Remind secondary actions via callbacks
//
// Intentionally isolated from the protected call signaling stack.
import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, MessageSquareText, BellRing, Video, X, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type IncomingCallInfo = {
  conversationId: string;
  callId: string;
  callType: "audio" | "video";
  fromName: string;
  fromId: string;
  isGroup?: boolean;
  groupParticipants?: { id: string; name: string; avatar?: string | null }[];
};

const CANNED = [
  "Can't talk right now, will call back 📞",
  "In a meeting — text me?",
  "On my way, give me 5 ✨",
];

export function IncomingCallScreen({
  info,
  onAccept,
  onDecline,
  onMessageInstead,
  onRemindMe,
}: {
  info: IncomingCallInfo;
  onAccept: () => void;
  onDecline: () => void;
  onMessageInstead: (text: string) => Promise<void> | void;
  onRemindMe: (minutes: number) => Promise<void> | void;
}) {
  const [sheet, setSheet] = useState<"none" | "reply" | "remind">("none");
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);

  // swipe-up-to-answer
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const onTouchStart = (e: React.TouchEvent) => {
    if (sheet !== "none") return;
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy < 0) setDragY(Math.max(dy, -180));
  };
  const onTouchEnd = () => {
    if (dragY < -110) {
      setDragY(0);
      startY.current = null;
      onAccept();
      return;
    }
    setDragY(0);
    startY.current = null;
  };

  const Icon = info.callType === "video" ? Video : Phone;
  const monogram = (info.fromName || "?").charAt(0).toUpperCase();
  const label = info.isGroup
    ? `ONIQ ${info.callType === "video" ? "Video" : "Audio"} Group Call`
    : `ONIQ ${info.callType === "video" ? "Video" : "Audio"} Call`;

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onMessageInstead(text.trim());
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      data-testid="incoming-call-screen"
      className="fixed inset-0 z-[100] overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 10%, color-mix(in oklab, var(--primary) 45%, transparent) 0%, transparent 55%), radial-gradient(120% 80% at 50% 100%, color-mix(in oklab, hsl(280 80% 55%) 35%, transparent) 0%, transparent 60%), #06080d",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* animated glow rings */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-24">
        <div className="relative">
          <span className="absolute inset-0 -m-16 rounded-full bg-primary/10 blur-3xl animate-pulse" />
        </div>
      </div>

      <div
        className="relative z-10 flex h-full flex-col items-center justify-between px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))]"
        style={{ transform: `translateY(${dragY * 0.35}px)`, transition: startY.current == null ? "transform 250ms cubic-bezier(0.2,0.9,0.3,1.3)" : undefined }}
      >
        {/* top: label + swipe hint */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="text-xs uppercase tracking-[0.24em] text-white/60">{label}</div>
          <div className="text-[11px] text-white/40">swipe up to answer</div>
        </div>

        {/* avatar + name */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <span className="absolute inset-0 -m-6 animate-ping rounded-full bg-primary/30" />
            <span className="absolute inset-0 -m-3 animate-pulse rounded-full bg-primary/40" />
            <div className="grid h-40 w-40 place-items-center rounded-full bg-gradient-to-br from-primary via-primary/80 to-accent text-6xl font-bold shadow-2xl shadow-primary/40">
              {monogram}
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-tight">{info.fromName}</div>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/70">
              <Icon className="h-4 w-4" />
              ringing…
            </div>
          </div>

          {info.isGroup && info.groupParticipants && info.groupParticipants.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur">
              <div className="flex -space-x-2">
                {info.groupParticipants.slice(0, 4).map((p) => (
                  <div
                    key={p.id}
                    className="grid h-7 w-7 place-items-center rounded-full border-2 border-black/40 bg-gradient-to-br from-primary/60 to-accent/60 text-[11px] font-bold"
                  >
                    {(p.name || "?").charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
              {info.groupParticipants.length > 4 && (
                <span className="text-xs text-white/70">
                  +{info.groupParticipants.length - 4} more
                </span>
              )}
              <span className="ml-1 text-xs text-white/60">on the call</span>
            </div>
          )}
        </div>

        {/* actions */}
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex w-full items-center justify-center gap-2">
            <button
              onClick={() => setSheet("reply")}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm backdrop-blur-xl transition hover:bg-white/10 active:scale-[0.98]"
            >
              <MessageSquareText className="h-4 w-4" />
              Message instead
            </button>
            <button
              onClick={() => setSheet("remind")}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm backdrop-blur-xl transition hover:bg-white/10 active:scale-[0.98]"
            >
              <BellRing className="h-4 w-4" />
              Remind me
            </button>
          </div>

          <div className="flex w-full items-center justify-around">
            <button
              data-testid="incoming-decline"
              onClick={onDecline}
              className="group flex flex-col items-center gap-2"
              aria-label="Decline call"
            >
              <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 transition group-active:scale-95">
                <PhoneOff className="h-7 w-7" />
              </span>
              <span className="text-xs text-white/70">Decline</span>
            </button>
            <button
              data-testid="incoming-accept"
              onClick={onAccept}
              className="group flex flex-col items-center gap-2"
              aria-label="Accept call"
            >
              <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/40 transition group-active:scale-95">
                <Phone className="h-7 w-7" />
              </span>
              <span className="text-xs text-white/70">Accept</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick reply sheet */}
      {sheet === "reply" && (
        <SheetShell title="Message instead" onClose={() => setSheet("none")}>
          <div className="flex flex-col gap-2">
            {CANNED.map((t) => (
              <button
                key={t}
                disabled={sending}
                onClick={async () => { await send(t); }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/90 transition hover:bg-white/10 disabled:opacity-60"
              >
                {t}
              </button>
            ))}
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Type a quick message…"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
              />
              <button
                disabled={sending || !custom.trim()}
                onClick={async () => { const t = custom; setCustom(""); await send(t); }}
                className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </SheetShell>
      )}

      {sheet === "remind" && (
        <SheetShell title="Remind me to call back" onClose={() => setSheet("none")}>
          <div className="grid grid-cols-3 gap-2">
            {[15, 60, 240].map((m) => (
              <button
                key={m}
                onClick={async () => { await onRemindMe(m); }}
                className="rounded-2xl border border-white/10 bg-white/5 py-4 text-sm transition hover:bg-white/10"
              >
                {m < 60 ? `${m} min` : `${m / 60} hr`}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/50">
            We'll ping you when it's time.
          </p>
        </SheetShell>
      )}
    </div>
  );
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl border-t border-white/10 bg-[#12141c] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
        style={{ animation: "slide-in-right 0.25s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-white/70 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Helper used by GlobalIncomingCall — send a chat message via existing schema. */
export async function sendQuickReply(conversationId: string, text: string) {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return;
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: uid,
    content: text,
    type: "text",
  } as never);
}

/** Helper used by GlobalIncomingCall — write a callback reminder row. */
export async function scheduleReminder(conversationId: string, peerName: string, minutes: number) {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return;
  const remindAt = new Date(Date.now() + minutes * 60_000).toISOString();
  await supabase.from("call_reminders" as never).insert({
    user_id: uid,
    conversation_id: conversationId,
    peer_name: peerName,
    remind_at: remindAt,
  } as never);
}
