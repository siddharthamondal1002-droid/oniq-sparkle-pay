import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Trash2, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadMomentBlob } from "@/components/moments/MomentsFeed";
import { PhotoStudio } from "@/components/photo/PhotoStudio";

/**
 * One shared bottom sheet for profile-photo management, reachable from the
 * main profile and My Page (which serves the chats/moments/reels world).
 * Uploads go through the same storage pattern as moment media; the saved
 * profiles.avatar_url shows everywhere avatars render.
 */
export function AvatarEditorSheet({
  currentUrl,
  onClose,
  onChanged,
}: {
  currentUrl: string | null;
  onClose: () => void;
  onChanged: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [studioFile, setStudioFile] = useState<File | null>(null);

  async function applyAvatar(url: string | null) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", u.user.id);
    if (error) throw error;
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("choose a photo 📷");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("keep it under 10MB");
      return;
    }
    // Photos flow through PhotoStudio (crop/filters + metadata strip).
    setStudioFile(file);
  }

  async function uploadEdited(file: File) {
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const url = await uploadMomentBlob(file, ext, file.type);
      await applyAvatar(url);
      toast.success("new look who dis 😎");
      onChanged(url);
    } catch (err: any) {
      toast.error(err.message ?? "upload failed — try again");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await applyAvatar(null);
      toast.success("photo removed");
      onChanged(null);
    } catch (err: any) {
      toast.error(err.message ?? "couldn't remove — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">profile photo 📸</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {currentUrl && (
          <div className="mb-4 flex justify-center">
            <img src={currentUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {currentUrl ? "upload new photo" : "upload photo"}
        </button>
        {currentUrl && (
          <button
            onClick={remove}
            disabled={busy}
            className="press mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/40 py-3 text-sm font-semibold text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> remove photo
          </button>
        )}
      </div>
      {studioFile && (
        <PhotoStudio
          file={studioFile}
          onCancel={() => setStudioFile(null)}
          onDone={(edited) => {
            setStudioFile(null);
            void uploadEdited(edited);
          }}
        />
      )}
    </div>
  );
}
