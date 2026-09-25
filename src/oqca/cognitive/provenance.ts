/**
 * WHERE A CLAIM CAME FROM, AND HOW STRONGLY IT IS HELD.
 *
 * §4 requires the world model to distinguish OBSERVED / INFERRED /
 * HYPOTHESIZED / VERIFIED and "never mix these states"; §11 requires every
 * conclusion to be labelled OBSERVED / SUPPORTED / VERIFIED / CONTESTED /
 * UNPROVEN. Those are two different axes and collapsing them is the first
 * mistake available here:
 *
 *   EPISTEMIC  how the claim was ARRIVED AT  (did anyone look?)
 *   STANDING   how well it is SUPPORTED NOW  (does the evidence hold?)
 *
 * A claim can be OBSERVED and CONTESTED at once — two readings disagreeing —
 * and a single enum could not say so.
 */

/** How a claim was arrived at. §4. */
export type Epistemic = "OBSERVED" | "INFERRED" | "HYPOTHESIZED" | "VERIFIED";

/** How well a claim is currently supported. §11. */
export type Standing = "OBSERVED" | "SUPPORTED" | "VERIFIED" | "CONTESTED" | "UNPROVEN";

export const EPISTEMIC_STATES: readonly Epistemic[] = [
  "OBSERVED",
  "INFERRED",
  "HYPOTHESIZED",
  "VERIFIED",
];

export const STANDINGS: readonly Standing[] = [
  "OBSERVED",
  "SUPPORTED",
  "VERIFIED",
  "CONTESTED",
  "UNPROVEN",
];

/**
 * WHAT PRODUCED A CLAIM. A model's opinion is a source like any other, and
 * naming it as one is what stops §11 being violated by accident: `model` can
 * never reach VERIFIED on its own, and `promote()` enforces that.
 */
export type SourceKind =
  | "direct_measurement"
  | "database_query"
  | "api_response"
  | "test_run"
  | "repository_read"
  | "documentation"
  | "independent_computation"
  | "model";

/** A source that cannot, alone, make anything VERIFIED. §11's whole point. */
export const NON_VERIFYING_SOURCES: readonly SourceKind[] = ["model"];

export type Provenance = {
  readonly source: SourceKind;
  /** Where somebody else can go and look. Never invented. */
  readonly locator: string;
  /** When the reading was taken, ISO. */
  readonly at: string;
  /** The exact bytes/rows, bounded. Verbatim, never reworded. */
  readonly excerpt: string | null;
};

/**
 * THE ONE PROMOTION RULE, AND IT IS DELIBERATELY NOT SYMMETRIC.
 *
 * A claim reaches VERIFIED only on evidence from a source that can verify, and
 * only with no contradicting evidence. Anything a model said is at most
 * SUPPORTED however many times it says it — repetition is not replication.
 */
export function promote(
  supporting: readonly Provenance[],
  contradicting: readonly Provenance[],
): Standing {
  if (supporting.length === 0 && contradicting.length === 0) return "UNPROVEN";
  if (contradicting.length > 0 && supporting.length > 0) return "CONTESTED";
  if (contradicting.length > 0) return "UNPROVEN";
  const verifying = supporting.filter((p) => !NON_VERIFYING_SOURCES.includes(p.source));
  if (verifying.length === 0) return "SUPPORTED";

  // Independence is established by canonical source identity, not row count.
  // Re-reading the same locator or repeating the same evidence kind is not replication.
  const independent = new Map<string, Provenance>();
  for (const p of verifying) {
    const canonical = `${p.source}:${p.locator.trim()}`;
    if (!independent.has(canonical)) independent.set(canonical, p);
  }

  const distinctKinds = new Set([...independent.values()].map((p) => p.source));
  if (independent.size >= 2 && distinctKinds.size >= 2) return "VERIFIED";
  return "OBSERVED";
}
