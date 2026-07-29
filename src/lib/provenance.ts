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
