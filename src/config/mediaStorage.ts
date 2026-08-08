// Track A4 — chat media storage. Configuration and the decisions behind it.
//
// Landed ahead of the implementation because A4 is fourth in the build order
// and the infrastructure has lead time. The bucket exists now; the upload path
// does not yet. Everything here is a constraint the implementation must meet,
// written down while the reasoning is fresh rather than reconstructed later.
//
// WHY R2 AND NOT SUPABASE STORAGE
//
// Egress, not storage, is the cost. Supabase charges about $0.09/GB out, so a
// 2 GB file shared to ten people is 20 GB of downloads — $1.80 for a single
// share. R2 charges ZERO egress. That one property is the whole argument, and
// it is why Postgres, auth, RLS and metadata stay on Supabase while only the
// bytes move.
//
// WHY 200 MB AND NOT 2 GB
//
// Two reasons, and the second matters more. 200 MB covers every real chat use.
// And 2 GB is a feature-length film: hosting files that size would make ONIQ a
// file-distribution service, carrying the piracy and CSAM exposure that already
// ruled out video hosting. The cap is a product boundary, not a quota.

/**
 * The bucket, created 2026-08-07.
 *
 * REGION: ENAM (Eastern North America), and that was a decision, not a default
 * anyone missed.
 *
 * R2's region is fixed at creation and cannot be changed afterwards — moving
 * it means a new bucket and a migration. The bucket landed in ENAM because the
 * create API exposes no location hint, and the trade was then considered
 * explicitly: for an India-first app, APAC would put first-byte closer on
 * upload. ENAM was accepted on 2026-08-07 rather than recreated.
 *
 * What that costs: uploads from India cross Cloudflare's backbone before they
 * land, which is a real penalty on a large chunked upload over mobile data.
 * What it does not cost: read latency for anything cached at the edge, and
 * nothing at all in egress charges.
 *
 * What it means for disclosure: chat media from Indian users is stored in
 * North America. DPDP does not mandate localisation for general personal data,
 * so this is not a compliance failure — but it is a fact about where user
 * content lives, and the Play Data safety form already declares Photos/videos
 * and Messages as collected. If the answer to "where does it live" ever needs
 * to change, it changes here and in the privacy notice together.
 */
export const MEDIA_BUCKET = {
  name: "oniq-chat-media",
  provider: "Cloudflare R2",
  region: "ENAM",
  createdOn: "2026-08-07",
  regionDecidedOn: "2026-08-07",
  regionDecision:
    "ENAM accepted rather than recreated in APAC. R2 region is immutable after creation; the India-latency cost was weighed and accepted.",
  /** Never public. Every read is a signed, expiring URL presigned server-side. */
  publicAccess: false,
} as const;

/**
 * 200 MB, enforced in BOTH places.
 *
 * Client-side so the user is told immediately instead of after a long upload,
 * and again at presign because a client-side check is a courtesy, not a
 * control — anything that can call the presign endpoint can lie about a size.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Chunk size for multipart. 5 MB is S3's minimum for all but the final part. */
export const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;

/**
 * Files expire. Re-send is available, so this loses nothing a user cannot
 * recover, and it keeps a chat app from silently becoming an archive.
 */
export const MEDIA_RETENTION_DAYS = { min: 30, max: 90 } as const;

/** How long a signed read URL stays valid. Short: they are cheap to reissue. */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * The memory rule, stated as configuration so it is not only a comment in a
 * test.
 *
 * A Capacitor WebView has a few hundred MB of budget on a mid-range phone.
 * Load 200 MB into it and Android kills the process — no dialog, no error, the
 * app simply vanishes. It will NOT reproduce in a desktop preview, which is
 * why the ban is enforced by grep in megaLoopGuardrails.test.ts rather than
 * discovered by testing.
 *
 * readAsDataURL is the worst of them: base64 inflates by about a third, so
 * 200 MB becomes a ~266 MB string.
 */
// CORRECTION, made while building A4 by actually reading the call sites.
//
// An earlier version of this comment said app.ai.tsx was "the banned pattern
// proper" and would "become fatal the moment A4 raises the cap to 200 MB".
// That was wrong, and wrong in a way that would have sent someone to fix the
// wrong file:
//
//   app.ai.tsx, app.study.tsx and app.vitals.tsx base64 a file to send to an
//   AI edge function. The API needs base64, so they cannot stream — but all
//   three were ALREADY capped (5/10/1 MB, 10 MB and 6 MB). They are not chat
//   media and the 200 MB cap below never applies to them.
//
//   saveFile.ts reads a PDF we generated ourselves. Bounded by construction.
//
//   CredentialCsvImport.tsx was the only genuinely unbounded one: file.text()
//   with no size check at all. It now caps at 2 MB.
//
// The ban below is still right; it just governs the chat-media upload path,
// which is the one that carries 200 MB files.
export const BANNED_WHOLE_FILE_READS = [
  "FileReader.readAsArrayBuffer",
  "FileReader.readAsDataURL",
  "FileReader.readAsBinaryString",
  "File.arrayBuffer",
  "File.text",
] as const;

/** Pass the File straight to fetch, or slice it. Never materialise it. */
export const REQUIRED_UPLOAD_METHOD =
  "Stream the File to fetch, or chunk with file.slice(). Chunking is required anyway for resumability.";

/**
 * Resumability is mandatory, not a nicety.
 *
 * A 200 MB upload on Indian mobile data will be interrupted — by a tunnel, a
 * lift, a wifi-to-mobile handover, or the OS backgrounding the app. Restarting
 * from zero each time means the upload never completes, so the feature would
 * not work at all rather than working slowly.
 */
export const UPLOAD_RESUME = {
  required: true,
  /** Retry the failed chunk, never the whole file. */
  retryGranularity: "chunk",
  /** Writes must be idempotent so a retried chunk cannot duplicate. */
  idempotentChunks: true,
  /** State persists so a resume survives the app being backgrounded. */
  persistAcrossBackgrounding: true,
  /** Must survive a network change mid-upload. */
  surviveNetworkSwitch: true,
} as const;

/**
 * Executables are blocked by CONTENT SIGNATURE, never by extension.
 *
 * Renaming payload.exe to holiday.jpg defeats an extension check completely,
 * and an extension check is worse than none because it looks like protection.
 * These are the leading bytes to refuse.
 */
export const BLOCKED_MAGIC_BYTES: { label: string; hex: string }[] = [
  { label: "Windows PE / DOS executable", hex: "4D5A" },
  { label: "ELF binary", hex: "7F454C46" },
  { label: "Mach-O 32-bit", hex: "FEEDFACE" },
  { label: "Mach-O 64-bit", hex: "FEEDFACF" },
  { label: "Java class", hex: "CAFEBABE" },
  { label: "Shell script shebang", hex: "2321" },
  { label: "Android package / JAR / ZIP container", hex: "504B0304" },
];

/**
 * Chat is not end-to-end encrypted — by design, so that translation can work —
 * which means ONIQ can see what it stores. That is precisely why the reporting
 * path has to work BEFORE file sharing ships: a service that can see its
 * content and offers no way to report it has chosen the worst of both.
 */
export const MEDIA_SAFETY = {
  reportingPathRequiredBeforeLaunch: true,
  blockOnMedia: true,
  /** Deleting a message deletes its bytes, not just the row. */
  deleteMessageDeletesMedia: true,
  /** Per-user rate caps, so one account cannot fill the bucket. */
  perUserRateCap: true,
} as const;

/** Bytes to a human string, for the client-side rejection message. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Is this file within the cap? The same answer both sides must reach. */
export function withinUploadCap(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_UPLOAD_BYTES;
}
