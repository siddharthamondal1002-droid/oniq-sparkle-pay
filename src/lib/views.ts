// P2 — the ONE client path for recording views. Qualified views only:
//   images/moments: ≥1s at ≥50% in viewport (timer cancelled on exit)
//   video/reels:    ≥3s of playback, or ≥50% of duration if shorter
// Owner never records on their own post; writes are session-deduped,
// queued and flushed on a debounce so a fast scroll never fires a write
// per item. Logs carry post ids only — never viewer identities.
import { supabase } from "@/integrations/supabase/client";

export type PostType = "moment" | "reel" | "update";

const seenThisSession = new Set<string>();
const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(postType: PostType, postId: string) {
  const key = `${postType}:${postId}`;
  if (seenThisSession.has(key)) return;
  seenThisSession.add(key);
  pending.add(key);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 800);
}

async function flush() {
  flushTimer = null;
  const batch = Array.from(pending);
  pending.clear();
  await Promise.all(
    batch.map(async (key) => {
      const [postType, postId] = key.split(":");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("record_post_view", {
        _post_type: postType,
        _post_id: postId,
      });
      if (error) {
        // allow a later retry for transient failures; ids only in logs
        seenThisSession.delete(key);
        console.warn("view record failed", postType, postId);
      }
    }),
  );
}

type Cleanup = () => void;

/**
 * Qualified IMAGE/TEXT view: element ≥50% visible for ≥1s.
 * Pass the element to observe (e.g. the post card). No-ops for the owner.
 */
export function watchImageView(
  el: HTMLElement,
  postType: PostType,
  postId: string,
  ownerId: string,
  meId: string | null,
  onQualified?: () => void,
): Cleanup {
  if (!meId || meId === ownerId) return () => {};
  if (seenThisSession.has(`${postType}:${postId}`)) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          if (!timer) {
            timer = setTimeout(() => {
              enqueue(postType, postId);
              onQualified?.();
              io.disconnect();
            }, 1000);
          }
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    },
    { threshold: 0.5 },
  );
  io.observe(el);
  return () => {
    if (timer) clearTimeout(timer);
    io.disconnect();
  };
}

/**
 * Qualified VIDEO view: ≥3s of accumulated playback, or ≥50% of duration,
 * whichever is shorter. No-ops for the owner.
 */
export function watchVideoView(
  video: HTMLVideoElement,
  postType: PostType,
  postId: string,
  ownerId: string,
  meId: string | null,
  onQualified?: () => void,
): Cleanup {
  if (!meId || meId === ownerId) return () => {};
  if (seenThisSession.has(`${postType}:${postId}`)) return () => {};
  let played = 0;
  let lastT: number | null = null;
  let done = false;
  const onTime = () => {
    if (done) return;
    const t = video.currentTime;
    if (lastT !== null && t > lastT && t - lastT < 1.5) played += t - lastT;
    lastT = t;
    const needed = Math.min(3, (video.duration || 6) * 0.5);
    if (played >= needed) {
      done = true;
      enqueue(postType, postId);
      onQualified?.();
      video.removeEventListener("timeupdate", onTime);
    }
  };
  const onSeek = () => {
    lastT = null;
  };
  video.addEventListener("timeupdate", onTime);
  video.addEventListener("seeking", onSeek);
  return () => {
    video.removeEventListener("timeupdate", onTime);
    video.removeEventListener("seeking", onSeek);
  };
}
