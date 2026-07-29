import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { captureVideoFrame, uploadClipThumb } from "@/lib/clipThumbs";
import {
  X, Pencil, Image as ImageIcon, Eye, Share2, Trash2, Loader2, Check, ChevronLeft,
} from "lucide-react";

const HASHTAG_RE = /#([\p{L}\p{M}\p{N}_]{1,30})/gu;
const HASHTAG_STRIP_RE = /#[\p{L}\p{M}\p{N}_]+/gu;

export type OwnedReel = {
  id: string;
  video_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  hashtags: string[] | null;
  visibility: string;
};

type Pane = "menu" | "edit" | "cover" | "visibility";

/**
 * Owner actions for a reel: edit caption/hashtags, change cover (frame
 * scrubber -> Phase 1 thumbnail pipeline), visibility, share, soft-delete.
 * Ownership is enforced server-side by the clips RLS policies
 * (UPDATE/DELETE scoped to auth.uid() = user_id) — this sheet is UI only.
 */
export function ReelOwnerSheet({
  clip,
  meId,
  onClose,
  onChanged,
  onDeleted,
}: {
  clip: OwnedReel;
  meId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [pane, setPane] = useState<Pane>("menu");
  const [busy, setBusy] = useState(false);

  // edit pane
  const initialCaption = [clip.caption ?? "", ...(clip.hashtags ?? []).map((h) => `#${h}`)]
    .filter(Boolean)
    .join(" ");
  const [caption, setCaption] = useState(initialCaption);

  // cover pane
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(0.1);

  useEffect(() => {
    if (pane !== "cover") return;
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [pane]);

  async function update(fields: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("clips").update(fields).eq("id", clip.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(okMsg);
    onChanged();
    return true;
  }

  async function saveEdit() {
    const tags = Array.from(caption.matchAll(HASHTAG_RE))
      .map((m) => m[1].toLowerCase())
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 10);
    const cleaned = caption.replace(HASHTAG_STRIP_RE, "").trim().slice(0, 300);
    if (await update({ caption: cleaned.length ? cleaned : null, hashtags: tags }, "reel updated ✏️")) onClose();
  }

  async function saveCover() {
    setBusy(true);
    try {
      const frame = await captureVideoFrame(clip.video_url, scrub);
      const url = await uploadClipThumb(meId, frame);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("clips").update({ thumbnail_url: url }).eq("id", clip.id);
      if (error) throw error;
      toast.success("new cover locked in 🖼️");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "couldn't grab that frame — try another spot");
    } finally {
      setBusy(false);
    }
  }

  async function setVisibility(v: "public" | "moots" | "private") {
    if (await update({ visibility: v }, v === "private" ? "reel is private now 🔒" : v === "moots" ? "moots only 🤝" : "reel is public 🌍")) onClose();
  }

  async function share() {
    const text = clip.caption ? `${clip.caption} — on ONIQ 🎬` : "check my reel on ONIQ 🎬";
    const url = "https://oniqhub.com";
    try {
      if (navigator.share) await navigator.share({ title: "ONIQ Reel", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success("copied to clipboard 📋");
      }
    } catch { /* user cancelled */ }
  }

  async function remove() {
    if (!window.confirm("Delete this reel? This can't be undone.")) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("clips").update({ is_deleted: true }).eq("id", clip.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("reel deleted");
    onDeleted();
    onClose();
  }

  const Row = ({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) => (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-medium disabled:opacity-50 ${
        danger ? "text-red-400 hover:bg-red-500/10" : "hover:bg-muted"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          {pane !== "menu" ? (
            <button onClick={() => setPane("menu")} aria-label="Back" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <h3 className="px-1 font-display text-base font-semibold">your reel 🎬</h3>
          )}
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {pane === "menu" && (
          <div className="space-y-0.5">
            <Row icon={<Pencil className="h-4 w-4" />} label="edit caption & tags" onClick={() => setPane("edit")} />
            <Row icon={<ImageIcon className="h-4 w-4" />} label="change cover" onClick={() => setPane("cover")} />
            <Row icon={<Eye className="h-4 w-4" />} label={`visibility · ${clip.visibility}`} onClick={() => setPane("visibility")} />
            <Row icon={<Share2 className="h-4 w-4" />} label="share" onClick={share} />
            <Row icon={<Trash2 className="h-4 w-4" />} label="delete reel" onClick={remove} danger />
          </div>
        )}

        {pane === "edit" && (
          <div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="caption… #hashtags welcome"
              className="w-full resize-none rounded-2xl border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={saveEdit}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} save
            </button>
          </div>
        )}

        {pane === "cover" && (
          <div>
            <div className="overflow-hidden rounded-2xl bg-black">
              <video
                ref={videoRef}
                src={clip.video_url}
                muted
                playsInline
                preload="auto"
                className="max-h-[40vh] w-full object-contain"
              />
            </div>
            <input
              type="range"
              min={0.05}
              max={Math.max(duration - 0.05, 0.1)}
              step={0.05}
              value={scrub}
              onChange={(e) => {
                const t = Number(e.target.value);
                setScrub(t);
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              className="mt-3 w-full accent-[hsl(var(--primary))]"
              aria-label="Pick cover frame"
            />
            <div className="mt-1 text-center text-[11px] text-muted-foreground">slide to the frame you want as the cover</div>
            <button
              onClick={saveCover}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} use this frame
            </button>
          </div>
        )}

        {pane === "visibility" && (
          <div className="space-y-2">
            {([
              ["public", "public 🌍 — everyone can watch"],
              ["moots", "moots only 🤝 — mutuals only"],
              ["private", "private 🔒 — just you, on your page"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                disabled={busy}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-sm font-medium disabled:opacity-50 ${
                  clip.visibility === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                }`}
              >
                {label}
                {clip.visibility === v && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
