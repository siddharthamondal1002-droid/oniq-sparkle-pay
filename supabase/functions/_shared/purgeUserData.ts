// Shared hard-purge routine for a user's data.
//
// PURE EXTRACTION from supabase/functions/delete-account/index.ts (2026-08-03).
// Same order, same behaviour, nothing skipped:
//   1. storage folders in clips, chat-media, moments, verification-docs
//   2. profiles row delete (best effort, in case the cascade FK isn't set)
//   3. auth.admin.deleteUser  (64 ON DELETE CASCADE FKs remove the rest)
// delete-account is covered by scripts/deletion-proof.ts — behaviour here must
// not drift. dsr-handler's internal_purge action calls this same function.
// deno-lint-ignore-file no-explicit-any

export const PURGE_BUCKETS = ["clips", "chat-media", "moments", "verification-docs"] as const;

export async function purgeUserData(
  admin: any,
  uid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Purge the user's storage objects (media, thumbnails, documents).
  // DB rows cascade off auth.users; storage objects do not — do it here.
  const purgeFolder = async (bucket: string, prefix: string, depth = 0): Promise<void> => {
    if (depth > 3) return;
    for (let page = 0; page < 50; page++) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
      if (error || !data || data.length === 0) return;
      const files = data.filter((o: any) => o.id).map((o: any) => `${prefix}/${o.name}`);
      const folders = data.filter((o: any) => !o.id).map((o: any) => `${prefix}/${o.name}`);
      if (files.length > 0) await admin.storage.from(bucket).remove(files);
      for (const f of folders) await purgeFolder(bucket, f, depth + 1);
      if (files.length === 0 && folders.length === 0) return;
      if (data.length < 100 && folders.length === 0) return;
    }
  };
  for (const bucket of PURGE_BUCKETS) {
    try {
      await purgeFolder(bucket, uid);
    } catch {
      // Best-effort per bucket; auth-row deletion below still removes access.
    }
  }

  // Best-effort: remove profile row first (in case cascade FK isn't set).
  await admin.from("profiles").delete().eq("id", uid);

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return { ok: false, error: delErr.message };
  return { ok: true };
}
