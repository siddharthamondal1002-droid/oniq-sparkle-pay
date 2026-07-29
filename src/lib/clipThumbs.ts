import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side reel thumbnail pipeline: grab a frame from a video (local file
 * or remote signed URL), encode as WebP capped at 720px on the longest edge,
 * upload into the caller's folder of the private `clips` bucket, and return
 * a long-lived signed URL (matching how the app stores all media URLs).
 */

const THUMB_EDGE = 720;
const SIGN_TTL = 60 * 60 * 24 * 365 * 100;

export function captureVideoFrame(
  src: string,
  atSeconds = 0.1,
  { crossOrigin = true, timeoutMs = 8000 }: { crossOrigin?: boolean; timeoutMs?: number } = {},
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    if (crossOrigin) v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    let done = false;
    const fail = (why: string) => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(why));
    };
    const cleanup = () => {
      v.removeAttribute("src");
      try { v.load(); } catch { /* noop */ }
    };
    const timer = setTimeout(() => fail("thumbnail timeout"), timeoutMs);

    v.onloadedmetadata = () => {
      // Some encoders put a black first frame at 0 — seek slightly in.
      const target = Math.min(Math.max(atSeconds, 0.05), Math.max((v.duration || 1) - 0.05, 0.05));
      v.currentTime = target;
    };
    v.onseeked = () => {
      if (done) return;
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return fail("no video dimensions");
        const scale = Math.min(1, THUMB_EDGE / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return fail("no canvas context");
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timer);
            if (!blob) return fail("encode failed");
            done = true;
            cleanup();
            resolve(blob);
          },
          "image/webp",
          0.8,
        );
      } catch (e) {
        fail(e instanceof Error ? e.message : "capture failed");
      }
    };
    v.onerror = () => fail("video load failed");
    v.src = src;
  });
}

export async function captureFrameFromFile(file: File, atSeconds = 0.1): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    // Local object URLs never taint the canvas — skip crossOrigin.
    return await captureVideoFrame(url, atSeconds, { crossOrigin: false });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadClipThumb(userId: string, blob: Blob): Promise<string> {
  const path = `${userId}/thumbs/${crypto.randomUUID()}.webp`;
  const { error: upErr } = await supabase.storage
    .from("clips")
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (upErr) throw upErr;
  const { data: signed, error: sErr } = await supabase.storage
    .from("clips")
    .createSignedUrl(path, SIGN_TTL);
  if (sErr || !signed) throw sErr ?? new Error("sign failed");
  return signed.signedUrl;
}

/** Best-effort: capture from a remote signed URL and persist onto the clip row. */
export async function backfillClipThumb(userId: string, clipId: string, videoUrl: string): Promise<string | null> {
  try {
    const blob = await captureVideoFrame(videoUrl, 0.1);
    const url = await uploadClipThumb(userId, blob);
    const { error } = await supabase
      .from("clips")
      .update({ thumbnail_url: url } as never)
      .eq("id", clipId);
    if (error) return null;
    return url;
  } catch {
    return null;
  }
}
