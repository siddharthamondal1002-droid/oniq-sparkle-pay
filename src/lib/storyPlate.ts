/**
 * The plate — one image the user hands the film to open on.
 *
 * WHAT IT IS. story-clip is Veo image-to-video: every shot in every ONIQ film
 * is a still that gets animated, and story-still is what normally draws that
 * still. A plate substitutes the user's own image for the first one. It costs
 * nothing extra because it REPLACES a call rather than adding one — one fewer
 * story-still request per film, the clip request unchanged.
 *
 * WHY THERE IS NO VIDEO HERE, and why the picker says so rather than
 * accepting one quietly. The engine has no video-in path at all: Veo takes an
 * image. A video upload could be stored and shown, but it could not reach the
 * generator, so a control that took one would be promising something the
 * pipeline cannot do. Saying "images" out loud is the honest version.
 */
import { supabase } from "@/integrations/supabase/client";

/** What Veo will actually take, and what a browser will reliably decode. */
export const PLATE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * 12 MB. A plate is ONE FRAME — a 4000px phone photo lands around 4 MB, so
 * this is generous for the real case while still refusing something that is
 * not a photo at all. The cap is here to be told to the user immediately; it
 * is not a control, because anything calling storage can lie about a size.
 */
export const MAX_PLATE_BYTES = 12 * 1024 * 1024;

export const PLATE_BUCKET = "story-plates";

export type PlateRejection =
  | { ok: false; reason: "video"; message: string }
  | { ok: false; reason: "type"; message: string }
  | { ok: false; reason: "size"; message: string };

export type PlateCheck = { ok: true } | PlateRejection;

/**
 * Decide about a file BEFORE any upload starts.
 *
 * A video gets its own branch rather than falling into the generic "wrong
 * type" message. Someone who picked a clip did not typo — they expected the
 * film to use it, and "images only" without a reason reads as a bug in the
 * picker rather than a limit of the engine.
 */
export function checkPlate(file: { type: string; size: number }): PlateCheck {
  if (file.type.startsWith("video/")) {
    return {
      ok: false,
      reason: "video",
      message:
        "Stories are built from still frames, so a video can't be used as the opening shot yet. Pick a photo and the film will start on it.",
    };
  }
  if (!PLATE_TYPES.includes(file.type as (typeof PLATE_TYPES)[number])) {
    return { ok: false, reason: "type", message: "That has to be a JPEG, PNG or WebP image." };
  }
  if (file.size > MAX_PLATE_BYTES) {
    return {
      ok: false,
      reason: "size",
      message: `That image is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ${MAX_PLATE_BYTES / 1024 / 1024} MB.`,
    };
  }
  return { ok: true };
}

/** The extension storage should store it under, derived from the MIME type. */
export function plateExtension(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

/**
 * Upload to `<uid>/<random>.<ext>` and return the object name.
 *
 * The uid prefix is not cosmetic: the bucket's RLS reads the first path
 * segment as the owner, so this layout IS the access control. A path that
 * does not start with the caller's own id is refused by storage, and again by
 * set_story_plate.
 */
export async function uploadPlate(
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const verdict = checkPlate(file);
  if (!verdict.ok) return { ok: false, message: verdict.message };

  // Resolved HERE rather than passed in. The uid IS the access control — the
  // bucket policy and set_story_plate both read it back out of the path — so
  // a caller handing over the wrong one would produce an upload that fails at
  // the storage layer for a reason nobody could see from the call site.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { ok: false, message: "You are signed out." };

  const name = `${userId}/${crypto.randomUUID()}.${plateExtension(file.type)}`;
  const { error } = await supabase.storage.from(PLATE_BUCKET).upload(name, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, path: name };
}
