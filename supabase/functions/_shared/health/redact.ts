/**
 * ONIQ HEALTH — what may leave the domain in a log, an audit row, an error
 * or a notification. Pure. MIRRORED byte for byte with
 * `supabase/functions/_shared/health/redact.ts` (`agreement.test.ts`).
 *
 * THE RULE IS A WHITELIST, NOT A BLACKLIST. A blacklist of "value", "notes",
 * "title" is a list of the fields somebody remembered; the next column added
 * to a table would flow straight through it. Everything below names what MAY
 * pass, and everything else is dropped — so a new medical field is redacted
 * by default, and only a deliberate edit here lets it out.
 */

/** Keys an audit row's `detail` may carry. Kinds and counts, never content. */
export const AUDIT_DETAIL_KEYS = [
  "kind",
  "category",
  "documentKind",
  "mime",
  "sizeBytes",
  "count",
  "status",
  "reason",
  "version",
  "purpose",
  "recipient",
  "action",
] as const;

/** Keys a log line may carry. */
export const LOG_KEYS = [
  "fn",
  "event",
  "action",
  "status",
  "reason",
  "requestId",
  "ms",
  "count",
  "outcome",
] as const;

const MAX_STRING = 64;

type Primitive = string | number | boolean;

function keep(
  input: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!input) return out;
  for (const key of allowed) {
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "string") out[key] = v.slice(0, MAX_STRING);
  }
  return out;
}

/** The `detail` an audit row may store. Drops everything not whitelisted. */
export function auditDetail(input: Record<string, unknown> | null | undefined) {
  return keep(input, AUDIT_DETAIL_KEYS);
}

/** The fields a log line may print. */
export function redactForLog(input: Record<string, unknown> | null | undefined) {
  return keep(input, LOG_KEYS);
}

/**
 * Reason codes are the only thing the server says about a refusal, and each
 * maps to a sentence written for the person. No sentence names a value, a
 * document or a record — a refusal must not become a side channel.
 */
export const REASON_MESSAGES: Record<string, string> = {
  health_disabled: "ONIQ Health isn't switched on yet.",
  uploads_disabled: "Document uploads aren't switched on yet.",
  unauthorized: "Please sign in again.",
  consent_required: "Turn on the storage consent in Health settings first.",
  not_found: "That item isn't there any more.",
  bad_input: "That didn't look right. Check the details and try again.",
  too_large: "That file is too large. Keep it under 10 MB.",
  bad_mime: "Only PDF, JPEG, PNG and WebP files can be stored.",
  region_blocked: "Health records aren't available in your country.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  not_uploaded: "The file didn't finish uploading. Try again.",
  size_mismatch: "The file that arrived doesn't match what was declared. Try again.",
  audit_failed: "Something went wrong. Try again.",
  method_not_allowed: "Something went wrong. Try again.",
  failed: "Something went wrong. Try again.",
};

export function safeMessage(reason: string | null | undefined): string {
  if (reason && Object.prototype.hasOwnProperty.call(REASON_MESSAGES, reason)) {
    return REASON_MESSAGES[reason];
  }
  return REASON_MESSAGES.failed;
}

/**
 * A notification about Health may say only that something is new. It must
 * not carry a kind, a value, a title or a document name — the system tray is
 * readable by anyone holding the phone.
 */
export const NOTIFICATION_TEXT = "ONIQ Health: something new in your records.";
