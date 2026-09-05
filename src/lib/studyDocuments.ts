// Where a kept study document lives, and what it is called.
//
// OWNER DIRECTIVE, 2026-09-05: ONIQ keeps what a student attaches to the tutor
// — worksheets, textbook photos, answer sheets — instead of discarding it once
// the model has read it. Before this, `app.study.tsx` turned the file into
// base64, `study-tutor` forwarded it inline, and nothing survived: the same
// worksheet was re-uploaded every session and the tutor could not refer back to
// last week's chapter PDF.
//
// THE NAME IS BUILT HERE BECAUSE THE SERVER REFUSES RATHER THAN REWRITES.
// firebaseServer's `safeFileSegment` is an allowlist that returns null for
// anything outside it — the right contract for a boundary, since scrubbing is
// many-to-one and two names that scrub alike would overwrite each other. But
// that contract means a phone filename it does not like is DROPPED, and
// "Résumé.pdf" or a Devanagari filename is not a rare case for ONIQ. So the
// scrubbing happens on this side, where a collision is harmless: the timestamp
// prefix already makes every name unique, so mapping two odd characters to the
// same "_" costs nothing.
//
// Day folders, not one flat prefix, because a listing is what a screen renders
// and a year of daily worksheets in one directory is not a screen.

/** Everything Study keeps lives under this, inside the caller's own space. */
export const STUDY_PREFIX = "study";

/** Matches firebaseServer's FILE_SEGMENT exactly. Keep the two in step. */
const ALLOWED = /[^A-Za-z0-9._\-() ]/g;

/** Leave room for the `HHMMSS-` prefix inside the server's 128 limit. */
const MAX_NAME = 100;

/**
 * A filename the server will accept, from one a phone actually produced.
 *
 * Refuses nothing: a student whose file is called something unusual should
 * still get it kept. What it will not do is produce a segment that traverses —
 * dots are collapsed the same way the server collapses them, so this cannot
 * hand back something the server would then reject or, worse, accept as a
 * path.
 */
export function safeStudyFilename(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const cleaned = s
    .normalize("NFKC")
    .replace(ALLOWED, "_")
    // A run of dots is traversal even after the allowlist, because "." survives
    // it. One dot between name and extension is all anybody needs.
    .replace(/\.{2,}/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  return cleaned || "file";
}

/** `study/2026-09-05/081500-beach day.jpg`, relative to the owner's prefix. */
export function studyObjectName(now: Date, filename: unknown): string {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${STUDY_PREFIX}/${day}/${time}-${safeStudyFilename(filename)}`;
}

/** Base64 for a text attachment, which arrives as a string rather than bytes. */
export function base64OfText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
