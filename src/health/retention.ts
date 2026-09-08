/**
 * ONIQ HEALTH — retention arithmetic. Pure. MIRRORED byte for byte with
 * `supabase/functions/_shared/health/retention.ts` (`agreement.test.ts`).
 *
 * THE PERIODS ARE PLACEHOLDERS. DPDP ties retention to purpose and counsel
 * sets the number; the table `health_retention_policies` is seeded with the
 * values below and labelled as such. A category with no policy is kept for
 * the life of the account (expiry null) — the honest default, because
 * inventing a shorter period would delete a person's records on an agent's
 * guess.
 */

export type RetentionPolicyLike = { category: string; retentionDays: number };

export const PLACEHOLDER_RETENTION: readonly RetentionPolicyLike[] = [
  { category: "documents", retentionDays: 3650 },
  { category: "vitals", retentionDays: 3650 },
  { category: "labs", retentionDays: 3650 },
  { category: "conditions", retentionDays: 3650 },
  { category: "medications", retentionDays: 3650 },
  { category: "allergies", retentionDays: 3650 },
  { category: "immunizations", retentionDays: 3650 },
  { category: "procedures", retentionDays: 3650 },
  { category: "encounters", retentionDays: 3650 },
  { category: "notes", retentionDays: 3650 },
  { category: "device_metrics", retentionDays: 730 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO expiry for a category written at `fromIso`, or null to keep. */
export function expiryFor(
  category: string,
  fromIso: string,
  policies: readonly RetentionPolicyLike[],
): string | null {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  const policy = policies.find((p) => p.category === category);
  if (!policy || !Number.isFinite(policy.retentionDays) || policy.retentionDays <= 0) return null;
  return new Date(from + policy.retentionDays * DAY_MS).toISOString();
}

export function isRetentionExpired(expiresAt: string | null | undefined, nowIso: string): boolean {
  if (!expiresAt) return false;
  const end = Date.parse(expiresAt);
  const now = Date.parse(nowIso);
  return !Number.isNaN(end) && !Number.isNaN(now) && end <= now;
}
