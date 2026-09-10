/**
 * TEMPORAL KNOWLEDGE — spec §10.
 *
 * **"Freshness must never be confused with confidence. A source can be highly
 * credible yet stale; a new source can be recent yet unreliable."**
 *
 * So staleness is computed HERE and confidence is computed in `promotion.ts`,
 * and neither reads the other's inputs. A single "quality" number that mixed
 * them would make a stale-but-excellent fact indistinguishable from a
 * fresh-but-flimsy one, and those two need opposite handling: the first needs
 * re-verification, the second needs more evidence.
 */
import type { KnowledgeRecord, Volatility } from "./record.ts";

const DAY = 86_400_000;

/**
 * How long a claim of each volatility may go unverified.
 *
 * `unknown` IS THE SHORTEST, not the longest, and that is the spec's own
 * instruction: "Unknown freshness: treat as stale until verified." The
 * intuitive reading — "we do not know, so leave it alone" — is exactly
 * backwards, and it is the reading a default would produce.
 *
 * `event_driven` is 0 because a wall clock is the wrong instrument for it
 * entirely: such a record is invalidated by something happening, not by time
 * passing, so it is stale from the moment it is written unless an event
 * explicitly re-verifies it.
 */
export const VERIFICATION_INTERVAL_MS: Readonly<Record<Volatility, number>> = {
  stable: 365 * DAY,
  slow: 90 * DAY,
  fast: 1 * DAY,
  event_driven: 0,
  unknown: 0,
};

export type Freshness = {
  readonly stale: boolean;
  readonly ageMs: number | null;
  readonly intervalMs: number;
  readonly reason: string;
};

/**
 * `now` IS AN ARGUMENT. The kernel bans a clock — `security.test.ts` walks this
 * tree — and a staleness function that read one could not be replayed anyway:
 * the same record would be fresh in one run and stale in the next.
 */
export function freshness(r: KnowledgeRecord, nowMs: number): Freshness {
  const interval = VERIFICATION_INTERVAL_MS[r.volatility];
  const last = r.validity.lastVerifiedAt;
  if (last === null) {
    return {
      stale: true,
      ageMs: null,
      intervalMs: interval,
      reason: "never verified",
    };
  }
  const at = Date.parse(last);
  if (!Number.isFinite(at)) {
    return { stale: true, ageMs: null, intervalMs: interval, reason: "unparseable lastVerifiedAt" };
  }
  const age = nowMs - at;
  if (interval === 0) {
    return {
      stale: true,
      ageMs: age,
      intervalMs: 0,
      reason:
        r.volatility === "event_driven"
          ? "event-driven: time cannot re-verify it"
          : "unknown volatility: stale until verified",
    };
  }
  return {
    stale: age > interval,
    ageMs: age,
    intervalMs: interval,
    reason: age > interval ? `unverified for ${Math.round(age / DAY)}d` : "within its interval",
  };
}

/**
 * An EXPIRED record is a different thing from a stale one, and conflating them
 * would be wrong in the dangerous direction. Stale means "check this again";
 * expired means "the record itself says it stopped being true".
 */
export function expired(r: KnowledgeRecord, nowMs: number): boolean {
  const until = r.validity.validUntil;
  if (until === null) return false;
  const at = Date.parse(until);
  return Number.isFinite(at) && nowMs > at;
}

/**
 * NOT YET IN FORCE. A record with a future `validFrom` is not knowledge about
 * now, and a reader that ignored this would act on a scheduled change early.
 */
export function notYetValid(r: KnowledgeRecord, nowMs: number): boolean {
  const from = r.validity.validFrom;
  if (from === null) return false;
  const at = Date.parse(from);
  return Number.isFinite(at) && nowMs < at;
}

/**
 * THE ONE PREDICATE A DECISION SHOULD ASK. It composes status, expiry and
 * validity window — and it deliberately does NOT consult staleness, because a
 * stale VERIFIED record is still the best ONIQ has and refusing it would leave
 * the loop with nothing rather than with something it knows to re-check.
 * Staleness schedules work; expiry withdraws a fact.
 */
export function usableNow(r: KnowledgeRecord, nowMs: number): boolean {
  if (r.status !== "VERIFIED") return false;
  if (expired(r, nowMs)) return false;
  if (notYetValid(r, nowMs)) return false;
  return true;
}

/** §18's "Staleness rate", computed over a set rather than asserted. */
export function stalenessRate(rs: readonly KnowledgeRecord[], nowMs: number): number {
  const active = rs.filter((r) => r.status === "VERIFIED" || r.status === "CONTESTED");
  if (active.length === 0) return 0;
  return active.filter((r) => freshness(r, nowMs).stale).length / active.length;
}
