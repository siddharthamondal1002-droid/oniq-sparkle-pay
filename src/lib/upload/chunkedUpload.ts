// Track A4 — the client half of chat media uploads.
//
// Pure logic on purpose. Everything here is a decision about WHICH bytes to
// send and WHEN to give up, with the actual network call injected. That makes
// the hard parts — resume arithmetic, magic-byte screening, retry backoff —
// testable without a network, a bucket or a phone, which matters because the
// failure this code exists to prevent is one that only reproduces on a real
// device on real mobile data.
//
// THE ONE RULE: THE FILE IS NEVER MATERIALISED.
//
// A Capacitor WebView has a few hundred MB of budget on a mid-range phone.
// Read a 200 MB file into a string or an ArrayBuffer and Android kills the
// process — no dialog, no error, the app simply disappears. So the File is
// only ever sliced: file.slice(a, b) returns a Blob that is a VIEW, not a
// copy, and fetch streams it. Nothing in this module calls arrayBuffer(),
// text(), or any FileReader method on the whole file.
//
// The one exception is the first few bytes, read deliberately and bounded to
// MAGIC_BYTES_TO_READ, because you cannot check a file signature without
// looking at the signature.
import {
  BLOCKED_MAGIC_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  formatBytes,
  withinUploadCap,
} from "@/config/mediaStorage";

/** Longest blocked signature is 4 bytes; 8 gives room without cost. */
export const MAGIC_BYTES_TO_READ = 8;

export type UploadPart = { partNumber: number; start: number; end: number };

export type PartResult = { partNumber: number; etag: string };

/** What a caller must provide. Injected so this module stays pure. */
export type ChunkedUploadIo = {
  /** Upload one slice. Must be idempotent for a given partNumber. */
  putPart: (part: UploadPart, body: Blob, signal?: AbortSignal) => Promise<string>;
  /** Parts already stored from an earlier attempt, for resume. */
  listUploadedParts?: () => Promise<PartResult[]>;
  /** Called after every part so a caller can persist progress. */
  onProgress?: (done: number, total: number, bytesSent: number) => void;
};

export type RejectReason =
  | { kind: "empty" }
  | { kind: "too-large"; size: number; max: number; message: string }
  | { kind: "blocked-type"; label: string; message: string };

/**
 * Split a size into 5 MB parts.
 *
 * S3 and R2 require every part except the last to be at least 5 MB, so the
 * remainder goes on the END. Putting a short part anywhere else makes the
 * multipart completion fail — and it fails at the very end, after the whole
 * file has been uploaded, which is the most expensive moment to discover it.
 */
export function planParts(size: number, chunkBytes: number = UPLOAD_CHUNK_BYTES): UploadPart[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const parts: UploadPart[] = [];
  let start = 0;
  let n = 1;
  while (start < size) {
    const end = Math.min(start + chunkBytes, size);
    parts.push({ partNumber: n, start, end });
    start = end;
    n += 1;
  }
  // No merging of the final short part. The first draft folded it into the
  // previous one "to save a request", which was wrong twice: the 5 MB minimum
  // explicitly does NOT apply to the last part, and merging produced parts up
  // to 2x the chunk size (a 12 MB file came out as 5 + 7 rather than
  // 5 + 5 + 2), which defeats the point of a fixed chunk size for resume.
  return parts;
}

/**
 * Does this file's leading signature match something we refuse to host?
 *
 * By CONTENT, never by extension. Renaming payload.exe to holiday.jpg defeats
 * an extension check completely, and an extension check is worse than none
 * because it looks like protection.
 */
export function matchBlockedMagic(head: Uint8Array): string | null {
  const hex = Array.from(head)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  for (const sig of BLOCKED_MAGIC_BYTES) {
    if (hex.startsWith(sig.hex.toUpperCase())) return sig.label;
  }
  return null;
}

/**
 * Everything that can reject a file before a single byte is uploaded.
 *
 * Size is checked FIRST and separately from the signature read, so an
 * oversized file is refused without touching its contents at all.
 */
export async function screenFile(
  file: { size: number; slice: (a: number, b: number) => Blob },
  readHead: (blob: Blob) => Promise<Uint8Array>,
): Promise<RejectReason | null> {
  if (!file.size) return { kind: "empty" };

  if (!withinUploadCap(file.size)) {
    return {
      kind: "too-large",
      size: file.size,
      max: MAX_UPLOAD_BYTES,
      message: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}`,
    };
  }

  // Bounded read. This is the ONLY read of file contents on this path, and it
  // is MAGIC_BYTES_TO_READ bytes regardless of how big the file is.
  const head = await readHead(file.slice(0, MAGIC_BYTES_TO_READ));
  const blocked = matchBlockedMagic(head);
  if (blocked) {
    return {
      kind: "blocked-type",
      label: blocked,
      message: `Can't send that — it looks like ${blocked}, not a photo or video`,
    };
  }

  return null;
}

/** Exponential backoff with a ceiling. Deterministic, so it is testable. */
export function retryDelayMs(attempt: number): number {
  return Math.min(16_000, 1000 * 2 ** attempt);
}

export type UploadOutcome =
  | { ok: true; parts: PartResult[]; resumedFrom: number }
  | { ok: false; rejected: RejectReason }
  | { ok: false; failedPart: number; error: string };

/**
 * Upload a file in parts, resuming anything already stored.
 *
 * RESUME IS NOT A NICETY. A 200 MB upload on Indian mobile data WILL be
 * interrupted — a tunnel, a lift, a wifi-to-mobile handover, the OS
 * backgrounding the app. Restarting from zero each time means it never
 * finishes, so the feature would not work at all rather than working slowly.
 *
 * Retries are per PART, never per file, for the same reason.
 */
export async function uploadInParts(
  file: { size: number; slice: (a: number, b: number) => Blob },
  io: ChunkedUploadIo,
  opts: {
    maxAttemptsPerPart?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<UploadOutcome> {
  const maxAttempts = opts.maxAttemptsPerPart ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const parts = planParts(file.size);
  if (!parts.length) return { ok: false, rejected: { kind: "empty" } };

  // Ask what already landed. A failure to ask is not fatal — it just means
  // starting over, which is worse but still correct.
  const alreadyDone = new Map<number, string>();
  if (io.listUploadedParts) {
    try {
      for (const p of await io.listUploadedParts()) alreadyDone.set(p.partNumber, p.etag);
    } catch {
      alreadyDone.clear();
    }
  }
  const resumedFrom = alreadyDone.size;

  const results: PartResult[] = [];
  let bytesSent = 0;

  for (const part of parts) {
    const existing = alreadyDone.get(part.partNumber);
    if (existing) {
      results.push({ partNumber: part.partNumber, etag: existing });
      bytesSent += part.end - part.start;
      io.onProgress?.(results.length, parts.length, bytesSent);
      continue;
    }

    let lastError = "";
    let stored = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (opts.signal?.aborted)
        return { ok: false, failedPart: part.partNumber, error: "cancelled" };
      try {
        // A VIEW of the file, not a copy. This is the line the whole module
        // exists to protect.
        const body = file.slice(part.start, part.end);
        const etag = await io.putPart(part, body, opts.signal);
        results.push({ partNumber: part.partNumber, etag });
        bytesSent += part.end - part.start;
        io.onProgress?.(results.length, parts.length, bytesSent);
        stored = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt < maxAttempts - 1) await sleep(retryDelayMs(attempt));
      }
    }

    // Stop at the first part that will not go. Everything already stored stays
    // stored, so the next attempt resumes here rather than at zero.
    if (!stored) return { ok: false, failedPart: part.partNumber, error: lastError };
  }

  return { ok: true, parts: results, resumedFrom };
}
