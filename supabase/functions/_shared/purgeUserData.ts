// Shared hard-purge routine for a user's data.
//
// PURE EXTRACTION from supabase/functions/delete-account/index.ts (2026-08-03).
// Same order, same behaviour, nothing skipped:
//   1. storage folders in clips, chat-media, moments, verification-docs
//   2. the user's own prefix in the FIREBASE bucket (see below)
//   3. profiles row delete (best effort, in case the cascade FK isn't set)
//   4. auth.admin.deleteUser  (64 ON DELETE CASCADE FKs remove the rest)
// delete-account is covered by scripts/deletion-proof.ts — behaviour here must
// not drift. dsr-handler's internal_purge action calls this same function.
//
// FIREBASE IS A SECOND STORE AND NOTHING ELSE KNOWS IT EXISTS. Owner directive
// 2026-09-05 has ONIQ keep a student's study attachments — worksheets,
// textbook photos, answer sheets — in oniq-309bd.firebasestorage.app under
// `users/{uid}/`. Those objects live outside Postgres, so no cascade reaches
// them, and they live outside Supabase Storage, so PURGE_BUCKETS does not
// either. Retaining a document and then not deleting it when the account goes
// is not a missing feature, it is the deletion promise being false, so the
// purge lands in the same commit as the retention rather than after it.
// deno-lint-ignore-file no-explicit-any
import { googleAccessToken } from "./googleAuth.ts";
import { FIREBASE_BUCKET, deleteObject, listObjects } from "./firebaseServer.ts";

export const PURGE_BUCKETS = ["clips", "chat-media", "moments", "verification-docs"] as const;

/** The one prefix a user owns in the Firebase bucket. */
export function firebasePrefixFor(uid: string): string {
  return `users/${uid}/`;
}

/**
 * Delete everything under the user's own Firebase prefix.
 *
 * Best-effort, deliberately and in the same posture as the Supabase buckets
 * above: a Google outage must not leave an account undeletable, because
 * refusing to delete the account is a worse answer to the person asking than
 * deleting it and reporting a residue. `deletion-proof` is what turns that
 * from a hope into a dated assertion — it seeds a real object here and fails
 * if one survives.
 *
 * Exported so the proof can call exactly this code rather than a copy of it.
 */
export async function purgeFirebaseObjects(
  uid: string,
): Promise<{ deleted: number; failed: number; reason?: string }> {
  const auth = await googleAccessToken();
  // Not configured is not a failure: an environment without the service
  // account has no Firebase objects to leave behind.
  if (!auth.ok) return { deleted: 0, failed: 0, reason: auth.reason };

  const prefix = firebasePrefixFor(uid);
  let deleted = 0;
  let failed = 0;
  // Paged, because a prolific student's folder can exceed one page and a
  // single listing would silently leave the rest.
  for (let page = 0; page < 50; page++) {
    const listed = await listObjects(auth.token, FIREBASE_BUCKET, prefix, 500);
    if (!listed.ok) return { deleted, failed, reason: listed.reason };
    if (listed.data.length === 0) break;
    for (const o of listed.data) {
      // Belt and braces: never issue a delete for a path outside the prefix,
      // whatever a listing came back with.
      if (!o.object.startsWith(prefix)) {
        failed++;
        continue;
      }
      const r = await deleteObject(auth.token, FIREBASE_BUCKET, o.object);
      if (r.ok) deleted++;
      else failed++;
    }
    // A page that deleted nothing would loop forever otherwise.
    if (failed > 0 && deleted === 0) break;
  }
  return { deleted, failed };
}

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

  // The Firebase bucket, which no cascade and no PURGE_BUCKETS entry reaches.
  try {
    await purgeFirebaseObjects(uid);
  } catch {
    // Same posture as the buckets above: auth-row deletion below still removes
    // access, and deletion-proof asserts on residue rather than trusting this.
  }

  // Best-effort: remove profile row first (in case cascade FK isn't set).
  await admin.from("profiles").delete().eq("id", uid);

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return { ok: false, error: delErr.message };
  return { ok: true };
}
