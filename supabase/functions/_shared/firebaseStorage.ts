// Firebase Storage, the SERVER-SIDE shape. Owner directive 2026-09-05:
// "Storage = photos/videos/files".
//
// WHY SERVER-SIDE AND NOT THE CLIENT SDK. Firebase Storage rules authenticate
// on `request.auth.uid`, exactly as Firestore's do, so the client SDK path
// waits on the Firebase Auth switch. The service-account path does not: an
// edge function holding FIREBASE_SERVICE_ACCOUNT puts the bytes in the bucket
// and hands back a URL — which is precisely the shape ONIQ already uses for
// Supabase Storage today, so nothing about how a screen consumes a file has
// to change.
//
// THE PATH IS THE AUTHORIZATION, AND THAT IS THE WHOLE POINT OF THIS FILE.
// Postgres RLS governs every other store ONIQ has; it governs nothing here. A
// bucket reached with the service account has NO per-user boundary of its own
// — the credential can read and write every object in it. So the only thing
// standing between one person's photos and another's is that the server
// derives the object path from the caller's OWN id and never from anything
// they sent. `objectPathFor` is that derivation, and `safeSegment` is why a
// filename cannot climb out of it.
//
// The failure being designed against is concrete: accept a client-supplied
// path and `users/<someone-else>/private.jpg` is a valid string. Accept a
// filename with `..` in it and so is `users/me/../<someone-else>/private.jpg`.
// Both read as ordinary requests in a log.

/** The project's own bucket, per android/app/google-services.json. */
export const FIREBASE_BUCKET = "oniq-309bd.firebasestorage.app";

/** Long enough for a real filename, short enough to bound a key. */
export const MAX_SEGMENT = 120;

/** What a file may be filed under. A closed list, not a caller's string. */
export const KINDS = ["images", "video", "audio", "docs"] as const;
export type StorageKind = (typeof KINDS)[number];

export function isKind(v: unknown): v is StorageKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/**
 * One path segment, reduced to something that cannot traverse or escape.
 *
 * Allowlist, not denylist: anything outside [A-Za-z0-9._-] becomes "_". A
 * denylist has to anticipate every encoding of "/" and ".." — percent, UTF-8
 * overlong, backslash on some clients — and only has to miss one.
 */
export function safeSegment(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const cleaned = s
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    // A segment of dots is still traversal after the allowlist, because "."
    // and "_" both survive it. Collapse any run of dots to a single "_".
    .replace(/\.{2,}/g, "_")
    // A leading dot hides the file on some systems and reads as "current
    // directory" on others.
    .replace(/^\.+/, "")
    .slice(0, MAX_SEGMENT);
  return cleaned || "file";
}

/**
 * A usable owner id, or nothing. Deliberately NOT `safeSegment(uid)`.
 *
 * THE UID IS NEVER SCRUBBED, ONLY ACCEPTED OR REFUSED, and the difference is
 * a data-loss bug rather than a style choice. safeSegment maps everything
 * outside [A-Za-z0-9._-] to "_", so it is many-to-one: two DIFFERENT uids can
 * scrub to the SAME string, and the moment they do, two people share a folder
 * and each can read the other's files. Refusing is the only safe response to
 * an id that needed cleaning.
 *
 * Caught by its own test: the first version guarded with
 * `!owner || owner === "file"`, and `safeSegment("   ")` is `"___"` — truthy,
 * neither — so a whitespace-only uid sailed through into `users/___/`, a
 * folder shared by everyone who arrived with a blank id.
 *
 * The floor of 8 rejects "", " " and "a" while clearing both shapes ONIQ
 * actually has: a Supabase UUID is 36 and a native Firebase uid is 28.
 */
const OWNER_RE = /^[A-Za-z0-9._-]{8,128}$/;

export function validOwner(uid: unknown): uid is string {
  return typeof uid === "string" && OWNER_RE.test(uid) && !uid.includes("..");
}

/**
 * Where a file belonging to `uid` lives. The uid comes from the SERVER's view
 * of the caller — never from the request body — and the filename is scrubbed.
 */
export function objectPathFor(uid: string, kind: StorageKind, filename: unknown): string {
  if (!validOwner(uid)) throw new Error("refusing to build a path without a real owner");
  if (!isKind(kind)) throw new Error(`unknown storage kind: ${String(kind)}`);
  return `users/${uid}/${kind}/${safeSegment(filename)}`;
}

/** True only when `path` is inside `uid`'s own prefix. The read-side check. */
export function ownsPath(uid: unknown, path: string): boolean {
  if (!validOwner(uid)) return false;
  // The trailing slash makes this a FOLDER check, not a substring one:
  // without it, `users/<uid>-evil/` would match `users/<uid>`.
  return path.startsWith(`users/${uid}/`);
}

/** GCS wants the object name percent-encoded in the URL, slashes included. */
export function objectUrl(bucket: string, path: string): string {
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(path)}`;
}

/** Resumable/simple upload endpoint for one object. */
export function uploadUrl(bucket: string, path: string): string {
  return (
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(path)}`
  );
}

/**
 * The read-only question "may this credential write here?", asked without
 * writing. testIamPermissions returns ONLY the permissions the caller holds,
 * so an empty list is a definite no rather than an ambiguous error — which is
 * the property the Firestore HTML 404 lacked.
 */
export const STORAGE_PERMISSIONS = [
  "storage.objects.create",
  "storage.objects.get",
  "storage.objects.delete",
] as const;

export function testPermissionsUrl(bucket: string): string {
  const q = STORAGE_PERMISSIONS.map((p) => `permissions=${encodeURIComponent(p)}`).join("&");
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/iam/testPermissions?${q}`;
}
