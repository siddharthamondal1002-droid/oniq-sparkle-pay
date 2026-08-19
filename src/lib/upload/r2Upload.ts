// Track A4 — the client coordinator: screen, presign, stream, complete.
//
// THE FILE IS NEVER MATERIALISED. Every byte that leaves the phone leaves as a
// file.slice() Blob handed straight to fetch, which streams it. Nothing here
// calls arrayBuffer(), text() or any FileReader method on the whole file — the
// single bounded exception is the 8-byte signature read in screenFile(), which
// is how you check a file signature.
//
// Read a 200 MB file into a WebView instead and Android kills the process with
// no dialog and no error: the app simply vanishes. That failure does not
// reproduce in a desktop preview, so this module is written to make the wrong
// thing hard rather than to be caught in testing.
import { supabase } from "@/integrations/supabase/client";
import {
  MAGIC_BYTES_TO_READ,
  screenFile,
  uploadInParts,
  type PartResult,
  type RejectReason,
} from "./chunkedUpload";

/** Stored reference form. resolveMedia() knows how to sign these. */
export const R2_REF_PREFIX = "r2:";

export type R2UploadResult =
  | { ok: true; ref: string; key: string }
  | { ok: false; rejected: RejectReason }
  | { ok: false; error: string };

type CreateResponse = {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; start: number; end: number; url: string }>;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("media-presign", { body });
  if (error) {
    // The function's own message (413 too large, 429 rate cap, 415 blocked
    // type) is the useful one; a bare "FunctionsHttpError" is not.
    const detail = await (error as unknown as { context?: Response }).context
      ?.json?.()
      .catch(() => null);
    throw new Error(detail?.error || error.message || "upload failed");
  }
  return data as T;
}

/** Read the first bytes of a Blob. Bounded twice over — never the whole file. */
async function readHead(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, MAGIC_BYTES_TO_READ).arrayBuffer());
}

/**
 * Upload one file to R2 in 5 MB parts, resuming anything already stored.
 *
 * Returns an opaque `r2:<key>` reference to store in messages.media_url. The
 * key carries no filename and no guessable structure, and reads are signed for
 * five minutes at a time.
 */
export async function uploadFileToR2(
  file: File,
  opts: {
    onProgress?: (done: number, total: number, bytesSent: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<R2UploadResult> {
  const rejected = await screenFile(file, readHead);
  if (rejected) return { ok: false, rejected };

  let created: CreateResponse;
  try {
    created = await call<CreateResponse>({
      action: "create",
      size: file.size,
      mime: file.type,
      fileName: file.name,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "couldn't start the upload" };
  }

  const urlByPart = new Map(created.parts.map((p) => [p.partNumber, p.url]));

  const outcome = await uploadInParts(
    file,
    {
      putPart: async (part, body, signal) => {
        const url = urlByPart.get(part.partNumber);
        if (!url) throw new Error(`no url for part ${part.partNumber}`);
        // `body` is a VIEW of the file, not a copy. fetch streams it.
        const res = await fetch(url, { method: "PUT", body, signal });
        if (!res.ok) throw new Error(`part ${part.partNumber} failed (${res.status})`);
        const etag = res.headers.get("ETag") ?? res.headers.get("etag");
        if (!etag) throw new Error(`part ${part.partNumber} returned no ETag`);
        return etag.replace(/"/g, "");
      },
      onProgress: opts.onProgress,
    },
    { signal: opts.signal },
  );

  if (!outcome.ok) {
    // Leave the multipart upload abandoned rather than aborted when the user
    // cancelled: R2 keeps the stored parts, so a later attempt resumes.
    const parts = "failedPart" in outcome ? outcome : null;
    if (parts && parts.error !== "cancelled") {
      void call({ action: "abort", key: created.key, uploadId: created.uploadId }).catch(() => {});
    }
    return {
      ok: false,
      error: "rejected" in outcome ? outcome.rejected.kind : outcome.error || "upload failed",
    };
  }

  try {
    const parts: PartResult[] = outcome.parts;
    await call({ action: "complete", key: created.key, uploadId: created.uploadId, parts });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "couldn't finish the upload" };
  }

  return { ok: true, ref: `${R2_REF_PREFIX}${created.key}`, key: created.key };
}

/**
 * Tie a finished object to the message that carries it.
 *
 * Without this link the deletion trigger has nothing to find, and deleting the
 * message would leave the bytes behind.
 */
export async function attachR2ToMessage(ref: string, messageId: string): Promise<void> {
  if (!ref.startsWith(R2_REF_PREFIX)) return;
  await call({ action: "attach", key: ref.slice(R2_REF_PREFIX.length), messageId }).catch(() => {});
}
