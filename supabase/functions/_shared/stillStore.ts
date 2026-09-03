// stillStore — where a still lands, WHOEVER drew it.
//
// THE GATEWAY PROBLEM THIS CLOSES, measured 2026-09-02 on job 64874747. The
// still stage moved to the Lovable gateway and the gateway returns bytes; the
// GPU worker used to write its frame into the bucket itself. So every gateway
// still came back with `key: null`, and in-house motion — which does not take
// a frame, it re-derives the still's BUCKET KEY and animates whatever is there
// — had nothing to animate. All nine shots of that film refused their clip:
//
//   MOTION_VALIDATE FAIL: 0/9 shots have a character-motion source,
//                         9 still-only, 6 FAIL (action calls for motion)
//
// A movie-grade film rendered as nine Ken Burns shots. The guard was right to
// refuse — sending story-motion after an object nobody wrote would claim a GPU
// job only to fail its own download — but refusing is not the fix. The fix is
// that the object exists.
//
// WHY THIS IS THE RIGHT PLACE FOR IT, and not a workaround. inHouseMotion.ts
// already states the scheme: a still's id is derived from the SHOT
// (`stillIdFor(jobId, sceneId, shotId)`), and "the motion stage does not stage
// anything, it names a still that exists". The key is therefore a property of
// the shot, not of the engine that drew it. That the GPU happened to be the
// writer was an implementation detail of one engine, never part of the
// contract. A gateway still written to the same key is the SAME still by every
// rule the system already has: same prefix, same derivation, same lifecycle,
// same sweeper.
//
// THE "NO EDGE FUNCTION MAY WRITE HERE" RULE IS OBSOLETE, and this is worth
// stating because it is why the original design refused. characterRef.ts says
// "the media bucket's write credentials live in the endpoint alone — by
// design, so no browser and no edge function can put an object where a worker
// will read one". That has not been true since story-reference-publish
// shipped: it holds R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY and PUTs owner
// character references into this very bucket. The credential is already here;
// pretending otherwise cost a film its motion.
//
// WHAT THIS DOES NOT DO. It does not make the GPU work. The RunPod endpoint
// still has to start a worker for in-house motion to render anything, and on
// 2026-09-01 it could not. This removes the STRUCTURAL impossibility — the
// pairing is no longer incoherent — it does not remove the operational one.
// With IN_HOUSE_MOTION=off the stage routes to Veo, which takes bytes and
// never needed a key at all.

// NO REMOTE IMPORT IN THIS FILE, deliberately — it lives in
// stillStoreClient.ts, which nothing but the edge function imports.
//
// The dependency was moved twice before it landed here, and each move was
// forced by a check that could not run:
//
//   at the top of this file   vitest cannot load the module at all ("Only URLs
//                             with a scheme in: file and data are supported"),
//                             so none of this was testable
//   dynamically, in here      `tsc` still follows it — the test importing this
//                             module pulls it into the program, and CI fails
//                             with "Cannot find module https://esm.sh/..."
//   its own module            this file type-checks, unit-tests and reads
//                             without a network; the edge function composes
//                             the two
//
// The file that PUTs bytes into production storage should be the LAST one a
// checker cannot see. A dependency that makes its own module unverifiable is
// in the wrong place.

/** The bucket the GPU worker reads its inputs from. Mirrors contract.py. */
export const STILL_BUCKET = "oniq-gpu";

/**
 * PNG ONLY, deliberately.
 *
 * The gateway may answer with a JPEG (firstImage sniffs the magic bytes and
 * says so), and `stillKeyFor` names every still `.png` because the GPU only
 * ever produced one. Writing JPEG bytes under a .png key would hand the
 * worker's contract an input it may refuse — and it would refuse it AFTER
 * claiming a GPU job, which is the expensive place to find out.
 *
 * So a non-PNG frame is simply not stored. The film keeps the bytes, renders
 * classic, and says why. Degrading here costs nothing; degrading on the GPU
 * costs a job.
 */
export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

/**
 * A signed fetch and where to point it. Structural on purpose: storeStill needs
 * something that can sign a request, not aws4fetch specifically, so a test can
 * hand it a recorder and the production path can hand it the real client.
 */
export type StillStore = {
  r2: { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  endpoint: string;
};

/** What a client needs, as plain data — resolved and validated without one. */
export type StillStoreCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
};

/**
 * The store, or the NAMES of what is missing.
 *
 * A name is operator information; a value never is — the same rule
 * story-reference-publish and gpu-video hold, which is why nothing here ever
 * interpolates a credential into a response, a log or an error.
 */
export function readStillStoreEnv(
  get: (k: string) => string | undefined,
): StillStoreCredentials | { missing: string[] } {
  const accessKeyId = get("R2_ACCESS_KEY_ID") ?? "";
  const secretAccessKey = get("R2_SECRET_ACCESS_KEY") ?? "";
  const accountId = get("R2_ACCOUNT_ID") ?? "";
  const endpoint =
    get("R2_S3_ENDPOINT") ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const missing = [
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !endpoint && "R2_ACCOUNT_ID (or R2_S3_ENDPOINT)",
  ].filter(Boolean) as string[];
  if (missing.length) return { missing };
  return { accessKeyId, secretAccessKey, endpoint };
}

export type StoreOutcome =
  { stored: true; key: string; bytes: number } | { stored: false; reason: string };

/**
 * The S3-style error body, reduced to what an operator acts on: the `Code`,
 * and the first line of the `Message` when there is one. Bounded reads, never
 * a throw — a body that will not parse yields an empty string and the status
 * stands alone, exactly as it did before this existed.
 */
export async function r2ErrorDetail(res: Response): Promise<string> {
  let body = "";
  try {
    body = (await res.text()).slice(0, 4000);
  } catch {
    return "";
  }
  const code = /<Code>([^<]{1,80})<\/Code>/.exec(body)?.[1]?.trim() ?? "";
  const message = /<Message>([^<]{1,200})<\/Message>/.exec(body)?.[1]?.trim() ?? "";
  if (!code) return "";
  return message ? ` ${code}: ${message.slice(0, 120)}` : ` ${code}`;
}

/**
 * Put a drawn still where the motion stage will look for it.
 *
 * OVERWRITES, unlike a character reference. That is not an oversight and the
 * two cases are genuinely opposite: a reference version is immutable because a
 * finished film may have been drawn against it, while a still belongs to one
 * shot of one job and inHouseMotion.ts states the intent outright — "a redrawn
 * shot overwrites its own still rather than orphaning one". A retry that
 * refused to overwrite would leave the FIRST attempt's frame in place and
 * animate that, which is worse than either outcome anybody asked for.
 *
 * FAILS SOFT, ALWAYS. The frame is already drawn and already paid for by the
 * time this runs. A storage hiccup must never turn a good still into a failed
 * shot — the caller keeps the bytes, reports `key: null`, and the film renders
 * classic. Losing a frame to protect a key nobody has yet is a bad trade.
 *
 * VERIFIES THE DESTINATION, not the status code. story-reference-publish reads
 * the object back and compares byte counts for the same reason: a 200 says the
 * request was accepted, and the only thing that matters is whether the object
 * a later download will find is the one we meant to write.
 */
export async function storeStill(
  key: string,
  bytes: Uint8Array,
  store: StillStore,
): Promise<StoreOutcome> {
  if (!isPng(bytes)) return { stored: false, reason: "still-not-png" };
  const objectUrl = `${store.endpoint}/${STILL_BUCKET}/${key}`;
  // AN EXACT ArrayBuffer, not the view.
  //
  // Two reasons, and the first is the one that would have bitten silently.
  // A Uint8Array may be a WINDOW onto a larger buffer, and handing `.buffer`
  // straight over would upload the whole backing store — a still plus whatever
  // else happened to share it. The copy below is taken only when the view is
  // not already the whole buffer, so the common path stays allocation-free.
  //
  // The second is typing: `Uint8Array<ArrayBufferLike>` is not assignable to
  // `BodyInit`, so passing the view does not type-check. story-reference-publish
  // does exactly that and gets away with it only because this container cannot
  // reach esm.sh to type-check it at all — a check that never runs is not a
  // check, and casting the error away here would have inherited the same
  // blind spot instead of removing it.
  const exact =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);
  try {
    const put = await store.r2.fetch(objectUrl, {
      method: "PUT",
      body: exact,
      headers: { "content-type": "image/png" },
    });
    if (!put.ok) {
      // R2 SAYS WHY, and the reason carries it. A 403 is three different
      // facts wearing one status: AccessDenied (the token cannot write this
      // bucket), SignatureDoesNotMatch (the secret or endpoint is wrong for
      // this key), InvalidAccessKeyId (the key id is unknown to this account).
      // Three films on 2026-09-03 answered `still-store-403` and could not be
      // told apart, so the operator rotated a token that may never have been
      // the problem. The S3-style XML body names the code; it is read here,
      // bounded, and put beside the status. The bucket hint stays, because it
      // is still the likeliest of the three.
      const detail = await r2ErrorDetail(put);
      return {
        stored: false,
        reason:
          put.status === 403
            ? `still-store-403${detail} (the R2 credential may not be scoped to write ${STILL_BUCKET})`
            : `still-store-${put.status}${detail}`,
      };
    }
    const back = await store.r2.fetch(objectUrl, { method: "HEAD" });
    const storedBytes = Number(back.headers.get("content-length") ?? "-1");
    if (!back.ok || storedBytes !== bytes.byteLength) {
      return {
        stored: false,
        reason: `still-store-unverified (wrote ${bytes.byteLength}, read back ${storedBytes})`,
      };
    }
    return { stored: true, key, bytes: storedBytes };
  } catch (err) {
    return { stored: false, reason: `still-store-unreachable (${String(err).slice(0, 80)})` };
  }
}

/** Base64 to bytes, chunk-free — atob gives a binary string of known length. */
export function bytesOfBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
