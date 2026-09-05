/**
 * FIREBASE, SERVER SIDE ONLY — Firestore documents and Storage objects reached
 * with the service account ONIQ already holds.
 *
 * OWNER DIRECTIVE, 2026-09-05, and the shape it chose. The Firebase migration
 * offered two routes. The CLIENT route puts the Firebase JS SDK in the browser
 * and authorises with Firestore/Storage Security Rules — which means TWO
 * authorization systems, those rules and the 242 live Postgres RLS policies,
 * that must agree forever and will drift the first time one is edited alone.
 * The SERVER route, built here, keeps Lovable Cloud as the identity: the phone
 * presents its ordinary Supabase session, this backend re-derives who that is,
 * and Firebase only ever sees the service account.
 *
 * WHAT THAT BUYS TODAY. It needs no Firebase web app (still unregistered), no
 * Firebase Auth (zero users), and no user import — the three things that are
 * blocked in consoles this container cannot reach. It also leaves RLS as the
 * single authority on who may touch what, because Firebase is not being asked
 * to make that judgement at all.
 *
 * WHAT IT COSTS, stated rather than hidden: no realtime listeners and no
 * offline cache, because nothing client-side speaks to Firebase. That is
 * exactly why chat is NOT part of this change — a chat that has lost its live
 * listeners is worse than the one ONIQ ships today.
 *
 * PATHS ARE COMPUTED HERE, NEVER ACCEPTED. Every function in this file that
 * takes a user id builds the path itself under `users/{uid}/`. A caller
 * supplies a collection and a document NAME, both of which are validated
 * against a narrow charset — a path segment is the one input that turns an
 * authorised request into somebody else's data.
 *
 * NO CREDENTIAL IS EVER RETURNED OR LOGGED. Google's own refusal text IS
 * passed through, because the weather build turned on it: a refusal naming the
 * missing role is a fixable answer and a summary of it is a shrug.
 *
 * PURE HALVES FIRST, so the value mapping and the path rules are tested in
 * Node without a network or a key.
 */

/**
 * The bucket google-services.json names as the project's own, measured
 * 2026-09-05. Not a guess and not derived from the project id — Firebase
 * changed that suffix once already (`.appspot.com` -> `.firebasestorage.app`)
 * and a derived name would have been wrong.
 */
export const FIREBASE_BUCKET = "oniq-309bd.firebasestorage.app";

/** Firestore's REST host. The `(default)` database is the only one ONIQ uses. */
const FIRESTORE_HOST = "https://firestore.googleapis.com/v1";

/** Cloud Storage's JSON API host, and the host a V4 URL is signed against. */
const STORAGE_HOST = "https://storage.googleapis.com";
const STORAGE_UPLOAD_HOST = "https://storage.googleapis.com/upload/storage/v1";

/* ----------------------------------------------------------------- paths -- */

/**
 * One path segment, or null.
 *
 * Deliberately narrow: letters, digits, dash, underscore, dot — and never a
 * bare or doubled dot, which Firestore reserves and which is how `..` walks
 * out of a user's own subtree. Length is capped so a segment cannot be used
 * to smuggle a payload into a document id.
 */
export function safeSegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || s.length > 128) return null;
  if (s === "." || s === ".." || s.includes("..") || s.includes("/")) return null;
  return /^[A-Za-z0-9._-]+$/.test(s) ? s : null;
}

/**
 * One segment of a FILE name. Wider than `safeSegment`, on purpose.
 *
 * MEASURED against real filenames, 2026-09-05: `safeSegment` refuses anything
 * outside [A-Za-z0-9._-], which refuses a space — and a space is not an
 * attack, it is what a phone calls a photo. "Screenshot 2026-09-05 at
 * 10.13.45.png" and "WhatsApp Image 2026-09-05 (1).jpeg" are both ordinary
 * and both were rejected outright as "Bad file name". A guard nobody can
 * upload through gets loosened by whoever hits it next, and they will loosen
 * the traversal rule along with it.
 *
 * So the traversal rule is untouched — no "/", no ".", no "..", bounded
 * length — and only the CHARSET widens, by exactly the two characters
 * measured to matter. Still an allowlist, still no control characters, still
 * refuse-rather-than-rewrite, because rewriting is many-to-one and two names
 * that scrub alike would overwrite each other.
 *
 * NON-ASCII IS STILL REFUSED — "Résumé.pdf" does not pass. That is a known
 * gap, not an oversight: a caller that needs arbitrary names should send a
 * generated id and keep the display name in Firestore beside it, which is
 * what a photo library wants anyway.
 */
const FILE_SEGMENT = /^[A-Za-z0-9._\-() ]+$/;

export function safeFileSegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || s.length > 128) return null;
  if (s === "." || s === ".." || s.includes("..") || s.includes("/")) return null;
  return FILE_SEGMENT.test(s) ? s : null;
}

/** An object name may contain slashes; each piece still has to be a segment. */
export function safeObjectName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length > 6) return null;
  const clean = parts.map(safeFileSegment);
  return clean.every((p): p is string => p !== null) ? clean.join("/") : null;
}

/**
 * The owner prefix, or a throw.
 *
 * DEFENCE IN DEPTH, and the only reason it is not merely decorative. Today
 * every uid reaching these builders is `claims.sub` off a verified Supabase
 * JWT — a UUID, incapable of holding a slash. But the builders are exported
 * and the prefix they write IS the entire access-control story here: a bucket
 * reached with the service account has no per-user boundary of its own. The
 * day something calls one of these with an id from anywhere else — an edge
 * function, an admin "act as", a job row — a uid carrying "../" would walk
 * straight out of the subtree, and every caller currently passes the check,
 * so nothing is being loosened to add it.
 *
 * It throws rather than returning null because there is no safe fallback
 * path: a caller that cannot name an owner must not get a path at all.
 */
function ownerPrefix(uid: string): string {
  const safe = safeSegment(uid);
  if (!safe) throw new Error("refusing to build a path without a valid owner id");
  return `users/${safe}`;
}

/** Where a user's documents live. Built here; never taken from the client. */
export function userDocPath(uid: string, collection: string, docId: string): string {
  return `${ownerPrefix(uid)}/${collection}/${docId}`;
}

/** Where a user's collection lives. */
export function userCollectionPath(uid: string, collection: string): string {
  return `${ownerPrefix(uid)}/${collection}`;
}

/** Where a user's files live in the bucket. */
export function userObjectPath(uid: string, name: string): string {
  return `${ownerPrefix(uid)}/${name}`;
}

/* ---------------------------------------------------------------- values -- */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * A plain JSON value as Firestore's tagged representation.
 *
 * Integers are sent as `integerValue` (a STRING in Firestore's wire format,
 * which is not a typo of theirs — a 64-bit integer does not survive JSON) and
 * everything else numeric as `doubleValue`. Getting that pairing wrong is how
 * a count comes back as 3.0000000001.
 */
export function toFirestoreValue(v: Json): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  return { mapValue: { fields: toFirestoreFields(v) } };
}

export function toFirestoreFields(obj: Record<string, Json>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFirestoreValue(v);
  return out;
}

/** The inverse. Unknown tags become null rather than throwing on new types. */
export function fromFirestoreValue(v: unknown): Json {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if ("nullValue" in f) return null;
  if ("booleanValue" in f) return Boolean(f.booleanValue);
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return Number(f.doubleValue);
  if ("stringValue" in f) return String(f.stringValue);
  if ("timestampValue" in f) return String(f.timestampValue);
  if ("arrayValue" in f) {
    const values = (f.arrayValue as { values?: unknown[] })?.values ?? [];
    return values.map(fromFirestoreValue);
  }
  if ("mapValue" in f) {
    const fields = (f.mapValue as { fields?: Record<string, unknown> })?.fields ?? {};
    return fromFirestoreFields(fields);
  }
  return null;
}

export function fromFirestoreFields(fields: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
}

/* ------------------------------------------------------------------ urls -- */

export function firestoreDocUrl(projectId: string, path: string): string {
  return `${FIRESTORE_HOST}/projects/${projectId}/databases/(default)/documents/${path}`;
}

export function storageObjectUrl(bucket: string, object: string): string {
  return `${STORAGE_HOST}/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`;
}

export function storageUploadUrl(bucket: string, object: string): string {
  const q = new URLSearchParams({ uploadType: "media", name: object });
  return `${STORAGE_UPLOAD_HOST}/b/${bucket}/o?${q}`;
}

/**
 * The read-only question "may this credential write here?", asked without
 * writing. testIamPermissions returns ONLY the permissions the caller holds,
 * so an empty list is a definite no rather than an ambiguous error — which is
 * the property the Firestore HTML 404 lacked.
 *
 * It still earns its place next to the bridge selftest, which answers the same
 * question by actually writing: when the selftest FAILS, this separates "the
 * grant is missing" from "the bucket or project is wrong", and it does so
 * without leaving an object behind.
 */
export const STORAGE_PERMISSIONS = [
  "storage.objects.create",
  "storage.objects.get",
  "storage.objects.delete",
] as const;

export function testPermissionsUrl(bucket: string): string {
  const q = STORAGE_PERMISSIONS.map((p) => `permissions=${encodeURIComponent(p)}`).join("&");
  return `${STORAGE_HOST}/storage/v1/b/${bucket}/iam/testPermissions?${q}`;
}

/* --------------------------------------------------------------- signing -- */

const enc = (s: string) => new TextEncoder().encode(s);

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc(s)));
}

function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** RFC 3986 escaping of an object name, keeping the slashes readable. */
export function encodeObjectPath(object: string): string {
  return object
    .split("/")
    .map((p) =>
      encodeURIComponent(p).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * The canonical request a GOOG4 signature is taken over.
 *
 * Exported so the string can be asserted in a test without a private key —
 * a V4 signature is all-or-nothing, and "403 SignatureDoesNotMatch" says
 * nothing about WHICH line was wrong.
 */
export function v4CanonicalRequest(args: {
  bucket: string;
  object: string;
  query: string;
}): string {
  return [
    "GET",
    `/${args.bucket}/${encodeObjectPath(args.object)}`,
    args.query,
    "host:storage.googleapis.com",
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
}

/** `20260905T071500Z` — the only timestamp format V4 accepts. */
export function v4Timestamp(now: Date): { stamp: string; date: string } {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { stamp, date: stamp.slice(0, 8) };
}

/**
 * A short-lived read URL for one object, signed locally.
 *
 * Signed rather than proxied: the bytes must not pass through an edge
 * function, for the same reason media-presign exists — a proxied 200 MB read
 * buffers, times out and pays egress twice.
 */
export async function signedReadUrl(args: {
  bucket: string;
  object: string;
  clientEmail: string;
  privateKey: string;
  expiresInSeconds?: number;
  now?: Date;
}): Promise<string> {
  const expires = Math.min(Math.max(args.expiresInSeconds ?? 900, 60), 60 * 60 * 12);
  const { stamp, date } = v4Timestamp(args.now ?? new Date());
  const scope = `${date}/auto/storage/goog4_request`;
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${args.clientEmail}/${scope}`,
    "X-Goog-Date": stamp,
    "X-Goog-Expires": String(expires),
    "X-Goog-SignedHeaders": "host",
  }).toString();

  const canonical = v4CanonicalRequest({ bucket: args.bucket, object: args.object, query });
  const toSign = ["GOOG4-RSA-SHA256", stamp, scope, await sha256Hex(canonical)].join("\n");

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(args.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = hex(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc(toSign)));
  return `${STORAGE_HOST}/${args.bucket}/${encodeObjectPath(args.object)}?${query}&X-Goog-Signature=${sig}`;
}

/* -------------------------------------------------------------------- io -- */

export type FirebaseFailure = { ok: false; status: number; reason: string };
export type FirebaseOk<T> = { ok: true; data: T };
export type FirebaseResult<T> = FirebaseOk<T> | FirebaseFailure;

/** Google's own words, trimmed to something a log line can hold. */
async function failure(res: Response): Promise<FirebaseFailure> {
  const text = await res.text().catch(() => "");
  let reason = text.slice(0, 400);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (parsed?.error?.message) {
      reason =
        `${parsed.error.status ? `${parsed.error.status}: ` : ""}${parsed.error.message}`.slice(
          0,
          400,
        );
    }
  } catch {
    // Google answers some wrong-path requests with an HTML page; keeping the
    // first 400 characters of it is more use than pretending it was JSON.
  }
  return { ok: false, status: res.status, reason: reason || `http ${res.status}` };
}

export type FirestoreDoc = {
  path: string;
  fields: Record<string, Json>;
  updateTime: string | null;
};

function mapDoc(raw: unknown): FirestoreDoc {
  const r = (raw ?? {}) as { name?: string; fields?: Record<string, unknown>; updateTime?: string };
  return {
    path: (r.name ?? "").split("/documents/")[1] ?? "",
    fields: fromFirestoreFields(r.fields ?? {}),
    updateTime: r.updateTime ?? null,
  };
}

export async function getDoc(
  token: string,
  projectId: string,
  path: string,
): Promise<FirebaseResult<FirestoreDoc | null>> {
  const res = await fetch(firestoreDocUrl(projectId, path), {
    headers: { authorization: `Bearer ${token}` },
  });
  // A missing document is an ANSWER, not a failure — every caller here would
  // otherwise have to pattern-match a 404 out of an error string.
  if (res.status === 404) return { ok: true, data: null };
  if (!res.ok) return await failure(res);
  return { ok: true, data: mapDoc(await res.json()) };
}

/**
 * Write a document, replacing exactly the fields given.
 *
 * PATCH with an explicit updateMask, not PUT: without the mask Firestore
 * deletes every field the request omits, which turns "save the title" into
 * "lose everything else".
 */
export async function setDoc(
  token: string,
  projectId: string,
  path: string,
  fields: Record<string, Json>,
): Promise<FirebaseResult<FirestoreDoc>> {
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const url = `${firestoreDocUrl(projectId, path)}${mask ? `?${mask}` : ""}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) return await failure(res);
  return { ok: true, data: mapDoc(await res.json()) };
}

export async function deleteDoc(
  token: string,
  projectId: string,
  path: string,
): Promise<FirebaseResult<{ deleted: true }>> {
  const res = await fetch(firestoreDocUrl(projectId, path), {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) return await failure(res);
  return { ok: true, data: { deleted: true } };
}

export async function listDocs(
  token: string,
  projectId: string,
  collectionPath: string,
  pageSize = 50,
): Promise<FirebaseResult<FirestoreDoc[]>> {
  const q = new URLSearchParams({ pageSize: String(Math.min(Math.max(pageSize, 1), 200)) });
  const res = await fetch(`${firestoreDocUrl(projectId, collectionPath)}?${q}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { ok: true, data: [] };
  if (!res.ok) return await failure(res);
  const body = (await res.json()) as { documents?: unknown[] };
  return { ok: true, data: (body.documents ?? []).map(mapDoc) };
}

export async function uploadObject(
  token: string,
  bucket: string,
  object: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<FirebaseResult<{ object: string; size: number }>> {
  const res = await fetch(storageUploadUrl(bucket, object), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    body: bytes as BodyInit,
  });
  if (!res.ok) return await failure(res);
  const body = (await res.json()) as { name?: string; size?: string };
  return {
    ok: true,
    data: { object: body.name ?? object, size: Number(body.size ?? bytes.length) },
  };
}

export async function deleteObject(
  token: string,
  bucket: string,
  object: string,
): Promise<FirebaseResult<{ deleted: true }>> {
  const res = await fetch(storageObjectUrl(bucket, object), {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) return await failure(res);
  return { ok: true, data: { deleted: true } };
}
