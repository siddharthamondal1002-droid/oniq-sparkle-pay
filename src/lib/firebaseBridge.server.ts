// firebase-bridge — the ONLY way ONIQ talks to Firestore and Firebase Storage.
//
// OWNER DIRECTIVE, 2026-09-05: keep Lovable Cloud as the identity and have the
// backend talk to Firebase with the service account it already holds. So the
// caller presents an ordinary Lovable Cloud session, the server re-derives who
// they are from that token, and Firebase only ever sees the service account.
//
// WHY THE GATE IS HERE AND NOT IN FIREBASE. Firestore and Storage Security
// Rules key on `request.auth.uid`, which does not exist when the caller is a
// service account — every request would look like the same all-powerful
// principal. That is precisely why NO path is ever accepted from the client:
// the caller names a COLLECTION and a DOCUMENT, and the prefix `users/{uid}/`
// is prepended here from the verified session. A caller cannot spell their way
// into another user's subtree, because they never write the subtree.
//
// THE CAPS ARE THE OTHER HALF. An upload arrives as base64 in a JSON body, so
// it is buffered in this worker; 8 MB is the point past which that stops being
// free. Anything larger belongs on the R2 presigned path media-presign already
// implements, where the bytes never touch a server at all.
//
// NOT CHAT. Deliberately. Moving messages here would cost the realtime
// listeners that make chat chat, and that decision waits on the identity
// switch. Nothing in this file knows what a conversation is.
import {
  googleAccessToken,
  serviceAccountIdentity,
} from "../../supabase/functions/_shared/googleAuth.ts";
import {
  FIREBASE_BUCKET,
  deleteDoc,
  deleteObject,
  getDoc,
  listDocs,
  listObjects,
  safeObjectName,
  safeSegment,
  setDoc,
  signedReadUrl,
  uploadObject,
  userCollectionPath,
  userDocPath,
  userObjectPath,
  type FirestoreDoc,
  type StoredObject,
  type Json,
} from "../../supabase/functions/_shared/firebaseServer.ts";

/** Buffered in the worker, so it is small on purpose. See the header. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** A document is metadata, not storage. Firestore's own limit is ~1 MiB. */
export const MAX_DOC_BYTES = 256 * 1024;

/** Read inside the handler, never at module scope — Workers inject per call. */
const env = (k: string) => process.env[k];

export type BridgeRequest = {
  action:
    | "doc.get"
    | "doc.set"
    | "doc.delete"
    | "collection.list"
    | "file.upload"
    | "file.list"
    | "file.url"
    | "file.delete"
    | "selftest";
  collection?: string;
  docId?: string;
  fields?: Record<string, Json>;
  limit?: number;
  name?: string;
  contentType?: string;
  /** base64, for file.upload only. */
  data?: string;
};

/**
 * Everything a screen may be told. No credential, ever.
 *
 * Spelled out field by field rather than left open with an index signature:
 * an `unknown` value cannot cross the RPC boundary's serialization check, and
 * an open shape is also how a credential would one day slip into a response
 * without anybody having to write it down.
 */
export type BridgeResponse = {
  configured: boolean;
  /** Present when Firebase itself refused; carries Google's own words. */
  unavailable?: boolean;
  reason?: string;
  error?: string;
  doc?: FirestoreDoc | null;
  docs?: FirestoreDoc[];
  deleted?: boolean;
  object?: string;
  objects?: StoredObject[];
  size?: number;
  url?: string;
  expiresInSeconds?: number;
  project?: string;
  bucket?: string;
  firestore?: { ok: boolean; readBack?: boolean; reason?: string };
  storage?: { ok: boolean; bytes?: number; reason?: string };
};

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const refused = (reason: string): BridgeResponse => ({
  configured: true,
  unavailable: true,
  reason,
});

/**
 * Run one bridge action as `uid`.
 *
 * The uid is the VERIFIED one from the middleware; this function never reads a
 * user id out of the request body, and there is no parameter through which one
 * could be passed.
 */
export async function runBridge(uid: string, body: BridgeRequest): Promise<BridgeResponse> {
  const auth = await googleAccessToken(env);
  if (!auth.ok) {
    // Names the missing SECRET, never a value — googleAuth guarantees that.
    return { configured: false, reason: auth.reason };
  }
  const { token, projectId } = auth;

  switch (body.action) {
    case "doc.get":
    case "doc.set":
    case "doc.delete": {
      const collection = safeSegment(body.collection);
      const docId = safeSegment(body.docId);
      if (!collection || !docId) {
        return { configured: true, error: "Bad collection or document name" };
      }
      const path = userDocPath(uid, collection, docId);

      if (body.action === "doc.get") {
        const r = await getDoc(token, projectId, path);
        return r.ok ? { configured: true, doc: r.data } : refused(r.reason);
      }
      if (body.action === "doc.delete") {
        const r = await deleteDoc(token, projectId, path);
        return r.ok ? { configured: true, deleted: true } : refused(r.reason);
      }
      const fields = body.fields;
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        return { configured: true, error: "fields must be an object" };
      }
      if (JSON.stringify(fields).length > MAX_DOC_BYTES) {
        return { configured: true, error: "That document is too large" };
      }
      const r = await setDoc(token, projectId, path, fields);
      return r.ok ? { configured: true, doc: r.data } : refused(r.reason);
    }

    case "collection.list": {
      const collection = safeSegment(body.collection);
      if (!collection) return { configured: true, error: "Bad collection name" };
      const r = await listDocs(token, projectId, userCollectionPath(uid, collection), body.limit);
      return r.ok ? { configured: true, docs: r.data } : refused(r.reason);
    }

    case "file.upload": {
      const name = safeObjectName(body.name);
      if (!name) return { configured: true, error: "Bad file name" };
      const contentType =
        typeof body.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.contentType)
          ? body.contentType
          : "application/octet-stream";
      if (typeof body.data !== "string") return { configured: true, error: "data must be base64" };
      const bytes = decodeBase64(body.data);
      if (!bytes) return { configured: true, error: "data is not valid base64" };
      // Checked AFTER decoding: base64 overstates size by a third, and the
      // number that matters is what actually lands in the bucket.
      if (bytes.length > MAX_UPLOAD_BYTES) {
        return { configured: true, error: "That file is too large for this route" };
      }
      const object = userObjectPath(uid, name);
      const r = await uploadObject(token, FIREBASE_BUCKET, object, bytes, contentType);
      return r.ok
        ? { configured: true, object: r.data.object, size: r.data.size }
        : refused(r.reason);
    }

    // Listing is what makes an uploaded file findable again. Without it the
    // caller has to remember every name it ever wrote, and a forgotten name is
    // a file that may as well not have been stored.
    case "file.list": {
      // An absent prefix means "everything I own"; a present one is validated
      // exactly like any other name, so a listing cannot climb out either.
      const sub = body.name === undefined ? "" : safeObjectName(body.name);
      if (sub === null) return { configured: true, error: "Bad prefix" };
      const prefix = sub ? `${userObjectPath(uid, sub)}/` : userObjectPath(uid, "");
      const r = await listObjects(token, FIREBASE_BUCKET, prefix, body.limit);
      return r.ok ? { configured: true, objects: r.data } : refused(r.reason);
    }

    case "file.url": {
      const name = safeObjectName(body.name);
      if (!name) return { configured: true, error: "Bad file name" };
      const sa = serviceAccountIdentity(env);
      if (!sa) {
        return {
          configured: false,
          reason: "a signed link needs the service-account key, which is not configured",
        };
      }
      const url = await signedReadUrl({
        bucket: FIREBASE_BUCKET,
        object: userObjectPath(uid, name),
        clientEmail: sa.clientEmail,
        privateKey: sa.privateKey,
        expiresInSeconds: 900,
      });
      return { configured: true, url, expiresInSeconds: 900 };
    }

    case "file.delete": {
      const name = safeObjectName(body.name);
      if (!name) return { configured: true, error: "Bad file name" };
      const r = await deleteObject(token, FIREBASE_BUCKET, userObjectPath(uid, name));
      return r.ok ? { configured: true, deleted: true } : refused(r.reason);
    }

    // A self-test the owner can run from /app/admin/firebase: one document
    // round-trip and one small file, in the caller's OWN subtree, cleaned up
    // afterwards. It exists because "deployed" and "working" are different
    // claims and only the second one is worth anything.
    case "selftest": {
      const stamp = new Date().toISOString();
      const path = userDocPath(uid, "_bridge", "selftest");
      const wrote = await setDoc(token, projectId, path, { stamp, n: 1, ok: true });
      const read = wrote.ok ? await getDoc(token, projectId, path) : null;
      if (wrote.ok) await deleteDoc(token, projectId, path);

      const object = userObjectPath(uid, "_bridge/selftest.txt");
      const put = await uploadObject(
        token,
        FIREBASE_BUCKET,
        object,
        new TextEncoder().encode(`oniq bridge ${stamp}`),
        "text/plain",
      );
      if (put.ok) await deleteObject(token, FIREBASE_BUCKET, object);

      return {
        configured: true,
        project: projectId,
        bucket: FIREBASE_BUCKET,
        firestore: wrote.ok
          ? { ok: true, readBack: read?.ok ? read.data?.fields?.stamp === stamp : false }
          : { ok: false, reason: wrote.reason },
        storage: put.ok ? { ok: true, bytes: put.data.size } : { ok: false, reason: put.reason },
      };
    }

    default:
      return { configured: true, error: "Unknown action" };
  }
}
