// story-reference-publish — canonical character frames into the media bucket.
//
// WHY THIS EXISTS. Reference conditioning was implemented end to end and could
// not activate, because `story/ref/canon/<id>/v<n>.png` was empty: the worker
// reads a reference from the media bucket, and nothing had ever put one there.
//
// WHY IT IS A COPY AND NOT A GENERATION. The canonical frames ALREADY EXIST —
// they are ONIQ's own owner assets, finished frames, addressed by `assetPath`
// in the owner map. Re-drawing them would spend a GPU job each to produce
// something different from the bytes already on disk, and would change
// production assets nobody asked to change. This moves bytes; it does not make
// them. No GPU job, no model, no inference.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE CALLER MAY INFLUENCE, WHICH IS ALMOST NOTHING
//
//   supplied by the caller   a characterRefId, and optionally a version
//   resolved by this server  the source URL, the destination key, the bucket
//
// There is no field for a source URL and no field for a destination key. Both
// are derived: the source from the owner-asset map (origin-pinned to ONIQ's
// own host), the destination from the same allowlist the worker's contract
// independently re-validates. A caller holding a bucket path has nowhere to
// put it, which is the rule story-motion already holds for stills.
//
// ADMIN-GATED, because this WRITES to the media bucket. Reading a reference is
// something a film does; publishing one is an operator action, and the two
// deserve different gates.
//
// IMMUTABLE PER VERSION. A key that already exists is never overwritten —
// re-publishing produces v2, and films drawn against v1 keep looking like v1.
// Overwriting in place would silently change finished films.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

import {
  CANONICAL_VERSION,
  characterRefKey,
  isPublishableCharacterRef,
} from "../_shared/characterRef.ts";
import {
  ACTOR_ASSETS,
  ONIQ_ASSET_ORIGIN,
  assetUrl,
  referenceEligible,
} from "../../../src/data/storyActorAssets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The worker's bucket — where `storage.download` looks for a reference. */
const BUCKET = "oniq-gpu";
const SIGNING_REGION = "auto";

/**
 * Bounds on the bytes. A canonical frame is a still, not a film: the owner
 * frames measure ~1.4 MB, and anything an order of magnitude past that is not
 * a character reference however it is labelled.
 */
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const MIN_REFERENCE_BYTES = 1024;

/** PNG magic. Checked on the BYTES, because a content-type header is a claim. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** A face needs pixels; a panorama is a sheet by another name. */
export const MIN_REFERENCE_DIM = 256;
export const MAX_REFERENCE_DIM = 4096;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length > magic.length && magic.every((b, i) => bytes[i] === b);
}

/** png | jpeg | webp | null — from the bytes, never from the header. */
export function sniffImage(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (startsWith(bytes, JPEG_MAGIC)) return "jpeg";
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/**
 * PNG dimensions, read from the IHDR chunk.
 *
 * Nothing upstream of this function has looked at the pixels, and a 64x64
 * thumbnail has no face in it to anchor.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, PNG_MAGIC) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // ── 1. authenticate, 2. verify this caller may publish ──────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) return json({ error: "Auth unavailable" }, 500);

    const asCaller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRes, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await asCaller
      .from("profiles").select("is_admin").eq("id", userRes.user.id).maybeSingle();
    if (profile?.is_admin !== true) return json({ error: "Admins only" }, 403);

    // ── 3. resolve the canonical asset through the existing owner map ───────
    const body = await req.json().catch(() => ({}));
    const characterRefId =
      typeof body?.characterRefId === "string" ? body.characterRefId.trim() : "";
    if (!isPublishableCharacterRef(characterRefId)) {
      return json({ error: "not a publishable canonical character" }, 400);
    }
    const version = body?.version === undefined || body?.version === null
      ? CANONICAL_VERSION
      : body.version;
    if (!Number.isInteger(version) || version < 1 || version > 9999) {
      return json({ error: "version must be a positive integer" }, 400);
    }

    const actor = ACTOR_ASSETS.find((a) => a.characterRefId === characterRefId);
    // isPublishableCharacterRef proved both of these already. They are checked
    // again because this is the step that turns a name into a fetch, and a
    // defence that exists in only one place is one a refactor can delete.
    if (!actor || !referenceEligible(actor)) {
      return json({ error: "not a directly attachable canonical frame" }, 400);
    }

    // ── 4. the source is DERIVED and origin-pinned ──────────────────────────
    const sourceUrl = assetUrl(actor);
    if (!sourceUrl.startsWith(`${ONIQ_ASSET_ORIGIN}/`)) {
      // Unreachable from the map as it stands; kept because the map is data,
      // and data changes without anybody re-reading this function.
      return json({ error: "resolved source is not on ONIQ's own origin" }, 400);
    }

    // ── 5/6/7/8. fetch, then PROVE the bytes ────────────────────────────────
    const got = await fetch(sourceUrl);
    if (!got.ok) return json({ error: `source fetch ${got.status}` }, 502);
    const declared = Number(got.headers.get("content-length") ?? "0");
    if (declared > MAX_REFERENCE_BYTES) {
      return json({ error: `source declares ${declared} bytes` }, 413);
    }
    const bytes = new Uint8Array(await got.arrayBuffer());
    if (bytes.byteLength < MIN_REFERENCE_BYTES || bytes.byteLength > MAX_REFERENCE_BYTES) {
      return json({ error: `source is ${bytes.byteLength} bytes` }, 413);
    }
    const kind = sniffImage(bytes);
    if (kind !== "png") {
      // The destination key ends .png. A JPEG stored under a .png name is the
      // quiet mismatch that surfaces as an unexplained decode failure on a
      // rented GPU, hours later.
      return json({ error: `source is ${kind ?? "not an image"}, expected png` }, 415);
    }
    const size = pngSize(bytes);
    if (!size || size.width < MIN_REFERENCE_DIM || size.height < MIN_REFERENCE_DIM) {
      return json(
        { error: `source is ${size?.width}x${size?.height} — too small to anchor a face` },
        422,
      );
    }
    if (size.width > MAX_REFERENCE_DIM || size.height > MAX_REFERENCE_DIM) {
      return json(
        { error: `source is ${size.width}x${size.height} — beyond the decode bound` },
        422,
      );
    }

    // ── 9. the destination is DERIVED, never supplied ───────────────────────
    const destKey = characterRefKey(characterRefId, version);
    if (!destKey) return json({ error: "could not derive a destination key" }, 400);

    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
    const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
    const endpoint =
      Deno.env.get("R2_S3_ENDPOINT") ??
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
    if (!accessKeyId || !secretAccessKey || !endpoint) {
      // The NAME of a missing variable is operator information; no value ever
      // is. The rule gpu-video holds for RUNPOD_API_KEY.
      return json({
        configured: false,
        missing: [
          !accessKeyId && "R2_ACCESS_KEY_ID",
          !secretAccessKey && "R2_SECRET_ACCESS_KEY",
          !endpoint && "R2_ACCOUNT_ID (or R2_S3_ENDPOINT)",
        ].filter(Boolean),
      }, 200);
    }
    const r2 = new AwsClient({
      accessKeyId, secretAccessKey, region: SIGNING_REGION, service: "s3",
    });
    const objectUrl = `${endpoint}/${BUCKET}/${destKey}`;

    // ── IMMUTABLE: a version that exists is never overwritten ───────────────
    const existing = await r2.fetch(objectUrl, { method: "HEAD" });
    if (existing.ok) {
      return json({
        published: false,
        alreadyPresent: true,
        key: destKey,
        version,
        bytes: Number(existing.headers.get("content-length") ?? "0"),
        note:
          "this version already exists — publish a new version rather than " +
          "overwriting one a finished film may have been drawn against",
      });
    }

    // ── 10. copy ────────────────────────────────────────────────────────────
    const put = await r2.fetch(objectUrl, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "image/png" },
    });
    if (!put.ok) {
      return json({
        error: `destination write ${put.status}`,
        // The likeliest cause, named so an operator does not have to guess:
        // the edge runtime's R2 token is scoped to the chat-media bucket.
        hint: put.status === 403
          ? `the R2 credential may not be scoped to write ${BUCKET}`
          : undefined,
        key: destKey,
      }, 502);
    }

    // ── 11/12. verify the DESTINATION, not the response code ────────────────
    const back = await r2.fetch(objectUrl, { method: "HEAD" });
    const storedBytes = Number(back.headers.get("content-length") ?? "-1");
    if (!back.ok || storedBytes !== bytes.byteLength) {
      return json({
        error: `wrote ${bytes.byteLength} bytes, bucket reports ${storedBytes}`,
        key: destKey,
      }, 502);
    }

    // ── 13. record what was published ───────────────────────────────────────
    return json({
      published: true,
      key: destKey,
      characterRefId,
      version,
      bytes: bytes.byteLength,
      width: size.width,
      height: size.height,
      // The source PATH, not the full URL: enough to trace provenance, without
      // handing a caller a fetchable link they did not already have.
      sourcePath: actor.assetPath,
      gpuJobs: 0,
    });
  } catch (e) {
    console.error("story-reference-publish", e instanceof Error ? e.message : String(e));
    return json({ error: "Something went sideways — try again" }, 500);
  }
});
