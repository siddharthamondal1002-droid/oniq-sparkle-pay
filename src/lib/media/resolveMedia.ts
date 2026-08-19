// B1 — single choke point for turning stored media references into
// fetchable URLs. New code must come through here (ESLint blocks direct
// createSignedUrl/getPublicUrl elsewhere). Legacy rows store full signed
// http(s) URLs — those pass through untouched until the B1 data migration.
import { supabase } from "@/integrations/supabase/client";

const TTL = 300; // matches the sign-media hard cap
const REFRESH_MARGIN_MS = 30_000; // re-sign when within 30s of expiry

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/** Track A4 — an object in the R2 chat-media bucket, stored as `r2:<key>`. */
export const R2_REF_PREFIX = "r2:";

export function isStoragePath(ref: string): boolean {
  return (
    !!ref && !/^https?:\/\//i.test(ref) && !ref.startsWith("blob:") && !ref.startsWith("data:")
  );
}

/**
 * Resolve a media reference to a fetchable URL.
 * - Full http(s)/blob/data URLs (legacy rows) pass through unchanged.
 * - `r2:<key>` refs are signed by media-presign, which decides whether the
 *   caller is in the conversation the object was sent to.
 * - Bare storage paths are signed via the sign-media edge function with the
 *   caller's own session (storage RLS decides), cached until ~30s before expiry.
 */
export async function resolveMedia(bucket: string, ref: string): Promise<string> {
  if (ref?.startsWith(R2_REF_PREFIX)) return resolveR2(ref);
  if (!isStoragePath(ref)) return ref;
  const path = ref.replace(/^\/+/, "");
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > now) return hit.url;

  const { data, error } = await supabase.functions.invoke("sign-media", {
    body: { bucket, path, ttl: TTL },
  });
  if (error || !data?.url) throw new Error("media unavailable");
  cache.set(key, { url: data.url as string, expiresAt: now + TTL * 1000 });
  return data.url as string;
}

async function resolveR2(ref: string): Promise<string> {
  const key = ref.slice(R2_REF_PREFIX.length);
  const hit = cache.get(ref);
  const now = Date.now();
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > now) return hit.url;

  const { data, error } = await supabase.functions.invoke("media-presign", {
    body: { action: "get", key },
  });
  if (error || !data?.url) throw new Error("media unavailable");
  cache.set(ref, { url: data.url as string, expiresAt: now + TTL * 1000 });
  return data.url as string;
}

/** Resolve many refs concurrently; failed items resolve to null. */
export async function resolveMediaAll(
  bucket: string,
  refs: string[],
): Promise<Array<string | null>> {
  return Promise.all(refs.map((r) => resolveMedia(bucket, r).catch(() => null)));
}
