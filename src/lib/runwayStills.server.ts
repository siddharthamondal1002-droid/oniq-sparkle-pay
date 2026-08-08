// Scene-still upload/delete — server-only half of the admin video tool.
//
// Nothing here touches submit/poll/status, the cost guard or the kill switch.
// The admin gate is reused verbatim: requireAdmin() re-derives the caller from
// their JWT and checks is_admin before a single byte is written.
//
// THE FILE IS NEVER MATERIALISED. The Blob arrives as a stream-backed body and
// is handed straight to storage. The only read of contents is a bounded
// STILL_MAGIC_BYTES slice, because you cannot check a signature without
// looking at the signature.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { RUNWAY_BUCKET, requireAdmin } from './runway.server';
import {
  ALLOWED_STILL_MIME,
  STILL_MAGIC_BYTES,
  sniffImageMime,
  validateStillName,
  validateStillSize,
} from './stillValidation';

export type UploadResult = { name: string; replaced: boolean };

export async function uploadStill(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  file: Blob,
  filename: string,
  replace: boolean,
): Promise<UploadResult> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  const badName = validateStillName(filename);
  if (badName) throw new Error(badName);

  const badSize = validateStillSize(file.size);
  if (badSize) throw new Error(badSize);

  // Bounded read — 12 bytes, whatever the file size is.
  const head = new Uint8Array(await file.slice(0, STILL_MAGIC_BYTES).arrayBuffer());
  const sniffed = sniffImageMime(head);
  if (!sniffed) throw new Error('that is not a PNG, JPEG or WebP image');
  if (!(ALLOWED_STILL_MIME as readonly string[]).includes(sniffed)) {
    throw new Error('unsupported image type');
  }

  const path = `stills/${filename}`;

  // Overwrite protection. Never a silent replace: the caller has to say so.
  const { data: existing } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .list('stills', { limit: 1, search: filename });
  const clash = (existing ?? []).some((f) => f.name === filename);
  if (clash && !replace) throw new Error(`"${filename}" already exists — tick replace to overwrite`);

  const { error } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    // contentType comes from the SNIFFED bytes, not the client's claim.
    .upload(path, file, { contentType: sniffed, upsert: replace });
  if (error) throw new Error(`upload failed: ${error.message}`);

  return { name: filename, replaced: clash };
}

export async function deleteStill(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  filename: string,
): Promise<{ deleted: string }> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  const badName = validateStillName(filename);
  if (badName) throw new Error(badName);

  const { error } = await supabaseAdmin.storage
    .from(RUNWAY_BUCKET)
    .remove([`stills/${filename}`]);
  if (error) throw new Error(`delete failed: ${error.message}`);
  return { deleted: filename };
}
