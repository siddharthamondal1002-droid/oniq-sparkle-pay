/**
 * ONIQ HEALTH — consent evaluation. Pure. MIRRORED byte for byte with
 * `supabase/functions/_shared/health/consent.ts` (`agreement.test.ts`).
 *
 * ONE RULE, IN ONE PLACE. A consent covers a need when every clause below
 * holds; the server calls this before every write and every processing step
 * that is not the person looking at their own data, and the client calls it
 * only to decide what to show. The server's answer is the one that counts.
 *
 * REVOCATION IS IMMEDIATE. There is no cache: the row's status is read on
 * the request, so the request after a revoke is refused.
 */

export type ConsentLike = {
  purpose: string;
  dataCategories: readonly string[];
  recipient: string;
  status: string;
  startTime: string;
  expiryTime: string | null;
};

export type ConsentNeed = {
  purpose: string;
  category: string;
  recipient: string;
};

/** Structural, not chronological: the row says what it says. */
export function consentCovers(consent: ConsentLike, need: ConsentNeed, nowIso: string): boolean {
  if (consent.status !== "active") return false;
  if (consent.purpose !== need.purpose) return false;
  if (consent.recipient !== need.recipient) return false;
  if (!consent.dataCategories.includes(need.category)) return false;
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return false;
  const start = Date.parse(consent.startTime);
  if (Number.isNaN(start) || start > now) return false;
  if (consent.expiryTime !== null) {
    const end = Date.parse(consent.expiryTime);
    if (Number.isNaN(end) || end <= now) return false;
  }
  return true;
}

/** The first consent that covers the need, or null. Order is the caller's. */
export function findCovering<T extends ConsentLike>(
  consents: readonly T[],
  need: ConsentNeed,
  nowIso: string,
): T | null {
  for (const c of consents) if (consentCovers(c, need, nowIso)) return c;
  return null;
}

/** A row whose expiry has passed but whose status still says active. */
export function isPastExpiry(consent: ConsentLike, nowIso: string): boolean {
  if (consent.expiryTime === null) return false;
  const end = Date.parse(consent.expiryTime);
  const now = Date.parse(nowIso);
  return !Number.isNaN(end) && !Number.isNaN(now) && end <= now;
}

/**
 * Granting again for the same purpose and recipient supersedes: the previous
 * row is revoked and the new one carries the next version. History is never
 * edited, so a person can always see what they agreed to and when.
 */
export function nextVersion(
  existing: readonly { purpose: string; recipient: string; version: number }[],
  purpose: string,
  recipient: string,
): number {
  let max = 0;
  for (const c of existing) {
    if (c.purpose === purpose && c.recipient === recipient && c.version > max) max = c.version;
  }
  return max + 1;
}
