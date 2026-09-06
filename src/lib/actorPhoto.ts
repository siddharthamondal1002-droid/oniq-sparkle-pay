import { sniffImageMime, validateStillSize, STILL_MAGIC_BYTES } from "@/lib/stillValidation";

/**
 * A photo the person supplies as a character reference.
 *
 * Owner directive 2026-09-06: asked what a picture should do when added to a
 * film, the owner chose "character reference — a face that recurs". Until then
 * a film took no picture at all.
 *
 * THE SNIFF IS THE CHECK, NOT THE FILE'S OWN CLAIM. A picker hands over
 * `File.type`, which is derived from the extension and is therefore whatever
 * the file was named — rename a script `.png` and the browser reports
 * `image/png`. Only the leading bytes say what something is, which is the rule
 * `stillValidation` already applies to admin uploads and the reason this reuses
 * it rather than writing a second, weaker one.
 *
 * BOUNDED, because `story-still` is not the only thing that has to survive
 * this: the bytes go to storage, and the row's mime is CHECK-constrained to
 * three values in Postgres. Sniffing a fixed 12-byte head means a 40 MB file
 * is refused after reading 12 bytes, never after reading 40 MB into memory —
 * the same rule `oniq-video`'s guardrails state for stills.
 */
/** What Postgres will accept for `story_actor_assets.mime`. */
const ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;
type ActorMime = (typeof ALLOWED)[number];

function isActorMime(m: string | null): m is ActorMime {
  return !!m && (ALLOWED as readonly string[]).includes(m);
}

export type ActorPhotoVerdict =
  { ok: true; mime: "image/png" | "image/jpeg" | "image/webp" } | { ok: false; message: string };

export function validateActorPhoto(size: number, head: Uint8Array): ActorPhotoVerdict {
  const tooBig = validateStillSize(size);
  // Rewritten for a person rather than an admin: "file is empty" is a
  // developer's sentence, and this one is shown on the character screen.
  if (tooBig) {
    return {
      ok: false,
      message: /empty/.test(tooBig)
        ? "That file is empty."
        : "That picture is too large (max 15MB).",
    };
  }

  const sniffed = sniffImageMime(head);
  if (!sniffed || !(ALLOWED as readonly string[]).includes(sniffed)) {
    return { ok: false, message: "That is not a PNG, JPEG or WebP picture." };
  }
  return {
    ok: true,
    mime: sniffed as ActorPhotoVerdict extends { ok: true; mime: infer M } ? M : never,
  };
}

/** How many leading bytes a caller must read before asking. */
export const ACTOR_PHOTO_HEAD_BYTES = STILL_MAGIC_BYTES;

/**
 * WHAT THE SCREEN SAYS ABOUT WHERE A PORTRAIT CAME FROM.
 *
 * A drawn portrait is AI-generated content and Play requires ONIQ to label it.
 * A photo the person took is NOT, and calling it "AI-generated" is a false
 * claim pointing the other way — which is why `story_actor_assets.source`
 * exists and why this reads it rather than the surface it happens to be on.
 */
export function actorPortraitAlt(name: string, source: string): string {
  return source === "uploaded" ? `Photo of ${name}` : `AI-generated portrait of ${name}`;
}

export function actorPortraitIsAi(source: string): boolean {
  return source !== "uploaded";
}
