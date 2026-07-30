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
  { crossOrigin = true, timeoutMs = 10000 }: { crossOrigin?: boolean; timeoutMs?: number } = {},
): Promise<Blob> {
  // Fade-in clips have black opening frames: scan forward until a frame has
  // enough luminance, then use it as the poster (max 5 tries, then keep the
  // last frame captured regardless).
  const SCAN_TIMES = [atSeconds, 0.6, 1.2, 2.0, 3.0];
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    if (crossOrigin) v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    let done = false;
    let attempt = 0;
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

    const seekTo = (t: number) => {
      const target = Math.min(Math.max(t, 0.05), Math.max((v.duration || 1) - 0.05, 0.05));
      v.currentTime = target;
    };
    v.onloadedmetadata = () => seekTo(SCAN_TIMES[0]);
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

        // Cheap luminance probe on a 32px downsample.
        let avgLuma = 255;
        try {
          const probe = document.createElement("canvas");
          probe.width = 32;
          probe.height = 32;
          const pctx = probe.getContext("2d")!;
          pctx.drawImage(canvas, 0, 0, 32, 32);
          const d = pctx.getImageData(0, 0, 32, 32).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          avgLuma = sum / (d.length / 4);
        } catch { /* tainted canvas etc — accept the frame */ }

        const nearBlack = avgLuma < 12;
        const lastTry = attempt >= SCAN_TIMES.length - 1;
        const beyondEnd = v.duration > 0 && SCAN_TIMES[attempt + 1] >= v.duration;
        if (nearBlack && !lastTry && !beyondEnd) {
          attempt++;
          seekTo(SCAN_TIMES[attempt]);
          return;
        }

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
