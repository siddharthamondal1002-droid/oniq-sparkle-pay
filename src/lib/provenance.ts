import { supabase } from "@/integrations/supabase/client";

/** SHA-256 of a blob's bytes, hex-encoded. Runs on-device via WebCrypto. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Best-effort provenance record (B4). Append-only via RLS; failure never
 * blocks the upload it describes.
 */
export async function recordProvenance(args: {
  contentType: "moment" | "clip" | "avatar" | "chat" | "other";
  contentId?: string | null;
  hash: string;
  declaredSynthetic?: boolean;
}): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("media_provenance").insert({
      uploader_id: u.user.id,
      content_type: args.contentType,
      content_id: args.contentId ?? null,
      sha256: args.hash,
      declared_synthetic: !!args.declaredSynthetic,
    });
  } catch {
    /* non-blocking */
  }
}

export type ScanVerdict = { verdict: "none" | "possible" | "likely" | "confirmed"; kind: "ai" | "ai_edited" | null };

/**
 * Server-side provenance scan (C2PA/XMP/EXIF markers — never pixels).
 * Returns the verdict so composers can pre-tick the synthetic declaration.
 * Best-effort: any failure reads as "none".
 */
export async function scanProvenance(args: {
  bucket: string;
  path: string;
  contentType: "moment" | "clip" | "avatar" | "chat" | "other";
  contentId?: string | null;
}): Promise<ScanVerdict> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).functions.invoke("media-provenance-scan", {
      body: { bucket: args.bucket, path: args.path, content_type: args.contentType, content_id: args.contentId ?? null },
    });
    if (error || !data) return { verdict: "none", kind: null };
    return { verdict: data.verdict ?? "none", kind: data.kind ?? null };
  } catch {
    return { verdict: "none", kind: null };
  }
}
