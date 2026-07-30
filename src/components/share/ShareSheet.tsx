import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Link2, Check, Loader2, Share2, Film } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  systemShare,
  shareTargets,
  shareMediaFile,
  canNativeShare,
  type SharePayload,
} from "@/lib/share";

type MootRow = { id: string; name: string; avatar_url: string | null };
type SendState = "idle" | "sending" | "sent" | "failed";

/**
 * Share sheet v2 — moots first (multi-select row), then link/system tools.
 * Reels route through share_reel_to_moots (server re-checks visibility per
 * recipient and polices sender_id); everything else sends the link through
 * the normal chat pipeline. The six external tiles only render as the
 * degraded fallback when no system share sheet exists (web / pre-v1.3).
 *
 * Contrast rules (reference surface): opaque sheet, no backdrop-blur on
 * text layers, labels ≥12px, primary text #E6EAE9.
 */
export function ShareSheet({
  payload,
  reel,
  onClose,
}: {
  payload: SharePayload;
  reel?: { id: string; videoUrl?: string };
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sendState, setSendState] = useState<Record<string, SendState>>({});
  const [sendingAll, setSendingAll] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [showVideoChoice, setShowVideoChoice] = useState(false);
  const [dlProgress, setDlProgress] = useState<number | null>(null);
  const [busyFile, setBusyFile] = useState(false);

  // Accepted moots minus blocked-either-direction.
  const { data: moots = [], isLoading } = useQuery({
    queryKey: ["share-moots"],
    queryFn: async (): Promise<MootRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      const me = u.user?.id;
      if (!me) return [];
      const [{ data: fr }, { data: bl }] = await Promise.all([
        supabase.from("friendships").select("user_a, user_b, status").eq("status", "accepted"),
        supabase.from("blocked_users").select("blocker_id, blocked_id"),
      ]);
      const blocked = new Set<string>();
      for (const b of bl ?? []) {
        if (b.blocker_id === me) blocked.add(b.blocked_id);
        if (b.blocked_id === me) blocked.add(b.blocker_id);
      }
      const others = Array.from(
        new Set((fr ?? []).map((f) => (f.user_a === me ? f.user_b : f.user_a)).filter((id) => !blocked.has(id))),
      );
      if (others.length === 0) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", others.slice(0, 100));
      return (profs ?? []).map((p) => ({
        id: p.id,
        name: (p.display_name ?? p.username ?? "moot").split(" ")[0],
        avatar_url: p.avatar_url,
      }));
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const nx = new Set(prev);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });
  }

  async function sendToMoots() {
    const ids = Array.from(selected);
    if (ids.length === 0 || sendingAll) return;
    setSendingAll(true);
    setSendState(Object.fromEntries(ids.map((id) => [id, "sending" as SendState])));
    try {
      if (reel) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc("share_reel_to_moots", {
          _clip_id: reel.id,
          _recipient_ids: ids,
          _note: note.trim() || null,
        });
        if (error) throw error;
        const next: Record<string, SendState> = {};
        const reasons: Record<string, string> = {
          not_moot: "not a moot",
          blocked: "unavailable",
          no_access: "can't view this reel",
          unavailable: "reel unavailable",
          skipped: "that's you",
        };
        for (const row of (data ?? []) as Array<{ recipient_id: string; status: string }>) {
          next[row.recipient_id] = row.status === "sent" ? "sent" : "failed";
          if (row.status !== "sent") {
            const who = moots.find((m) => m.id === row.recipient_id)?.name ?? "someone";
            toast.error(`${who}: ${reasons[row.status] ?? "couldn't send"}`);
          }
        }
        setSendState(next);
      } else {
        // Non-reel payloads: link message through the normal chat pipeline.
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("signed out");
        const body = `${note.trim() ? note.trim() + "\n" : ""}${payload.url}`;
        const next: Record<string, SendState> = {};
        for (const id of ids) {
          try {
            const { data: conv, error: cErr } = await supabase.rpc("find_or_create_direct_conversation", {
              other_user_id: id,
            });
            if (cErr || !conv) throw cErr ?? new Error("no conversation");
            const { error: mErr } = await supabase.from("messages").insert({
              conversation_id: conv as string,
              sender_id: u.user.id,
              content: body,
              type: "text",
            });
            if (mErr) throw mErr;
            next[id] = "sent";
          } catch {
            next[id] = "failed";
            const who = moots.find((m) => m.id === id)?.name ?? "someone";
            toast.error(`couldn't send to ${who}`);
          }
        }
        setSendState(next);
      }
      const okCount = Object.values(sendState).filter((s) => s === "sent").length;
      void okCount;
    } catch (e) {
      setSendState(Object.fromEntries(ids.map((id) => [id, "failed" as SendState])));
      toast.error(e instanceof Error ? e.message : "couldn't send");
    } finally {
      setSendingAll(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(payload.url);
      toast.success("Link copied 🔗");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = payload.url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast.success("Link copied 🔗");
    }
  }

  async function more() {
    if (reel?.videoUrl && canNativeShare()) {
      setShowVideoChoice(true);
      return;
    }
    const ok = await systemShare(payload);
    if (!ok) setShowFallback(true);
    else onClose();
  }

  async function shareVideoFileNow() {
    if (!reel?.videoUrl || busyFile) return;
    setBusyFile(true);
    setDlProgress(null);
    const res = await shareMediaFile(reel.videoUrl, `oniq-reel-${reel.id}.mp4`, payload, setDlProgress);
    setBusyFile(false);
    setDlProgress(null);
    if (res === "failed") toast.error("couldn't fetch the video — check your connection and try again");
    else if (res === "unsupported") {
      const ok = await systemShare(payload);
      if (!ok) setShowFallback(true);
      return;
    } else onClose();
  }

  const anySelected = selected.size > 0;
  const sentCount = useMemo(() => Object.values(sendState).filter((s) => s === "sent").length, [sendState]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[#E6EAE9]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">share it ✨</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 1 — moots row */}
        {isLoading ? (
          <div className="flex gap-3 overflow-hidden py-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        ) : moots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            add some moots to share inside ONIQ 🤝
          </p>
        ) : (
          <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {moots.map((m) => {
              const st = sendState[m.id] ?? (selected.has(m.id) ? "selected" : "idle");
              return (
                <button
                  key={m.id}
                  onClick={() => (sendState[m.id] === "sent" ? undefined : toggle(m.id))}
                  className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-xl p-1.5"
                  aria-label={`Send to ${m.name}`}
                  aria-pressed={selected.has(m.id)}
                >
                  <span className="relative">
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt=""
                        className={`h-14 w-14 rounded-full object-cover ${selected.has(m.id) ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                      />
                    ) : (
                      <span
                        className={`grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-lg font-bold text-white ${selected.has(m.id) ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                      >
                        {m.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    {st === "sent" && (
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-background">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {st === "sending" && (
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-muted ring-2 ring-background">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    )}
                    {st === "failed" && (
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-[10px] text-white ring-2 ring-background">!</span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-xs text-[#C9CFCE]">{m.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 2 — send bar */}
        {anySelected && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 300))}
              placeholder="add a note (optional)"
              className="min-w-0 flex-1 rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={sendToMoots}
              disabled={sendingAll}
              className="press shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {sendingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : `Send to ${selected.size}`}
            </button>
          </div>
        )}
        {sentCount > 0 && !anySelectedPending(sendState) && (
          <p className="mt-2 text-xs text-emerald-400">sent to {sentCount} ✓</p>
        )}

        {/* 3 — secondary row */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={copyLink}
            className="press flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold"
          >
            <Link2 className="h-4 w-4 text-primary" /> Copy link
          </button>
          <button
            onClick={more}
            className="press flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold"
          >
            <Share2 className="h-4 w-4 text-primary" /> More
          </button>
        </div>

        {/* video-vs-link choice (native reels only) */}
        {showVideoChoice && (
          <div className="mt-3 space-y-2 rounded-2xl border border-border p-3">
            <button
              onClick={async () => {
                setShowVideoChoice(false);
                const ok = await systemShare(payload);
                if (!ok) setShowFallback(true);
                else onClose();
              }}
              className="press w-full rounded-xl border border-border py-3 text-sm font-semibold"
            >
              Share link 🔗
            </button>
            <button
              onClick={shareVideoFileNow}
              disabled={busyFile}
              className="press flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Film className="h-4 w-4" />
              {busyFile
                ? dlProgress === null
                  ? "preparing…"
                  : `downloading ${dlProgress}%`
                : "Share the video file 🎬"}
            </button>
            <p className="text-xs text-muted-foreground">sharing the file downloads the full video first</p>
          </div>
        )}

        {/* degraded fallback — web / installs older than v1.3 only */}
        {showFallback && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {shareTargets(payload).map((t) => (
              <a
                key={t.id}
                href={t.href}
                {...(t.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                onClick={onClose}
                className="press flex flex-col items-center gap-1.5 rounded-xl border border-border py-3"
              >
                <span className="text-xl leading-none">{t.emoji}</span>
                <span className="text-xs font-semibold text-[#C9CFCE]">{t.label}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function anySelectedPending(state: Record<string, SendState>): boolean {
  return Object.values(state).some((s) => s === "sending");
}
