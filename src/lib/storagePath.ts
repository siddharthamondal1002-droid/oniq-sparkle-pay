import { supabase } from "@/integrations/supabase/client";

/**
 * Parse a Supabase storage URL (signed or public) back into {bucket, path}.
 * Rows store full signed URLs; deleting the underlying object needs the path.
 */
export function parseStorageRef(url: string): { bucket: string; path: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  try {
    return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch {
    return { bucket: m[1], path: m[2] };
  }
}

/** Best-effort removal of the storage objects behind a list of media URLs.
 *  Returns the number of objects that failed to delete (0 = clean). */
export async function removeStorageObjects(urls: Array<string | null | undefined>): Promise<number> {
  let failures = 0;
  for (const u of urls) {
    if (!u) continue;
    const ref = parseStorageRef(u);
    if (!ref) continue;
    const { error } = await supabase.storage.from(ref.bucket).remove([ref.path]);
    if (error) failures++;
  }
  return failures;
}
