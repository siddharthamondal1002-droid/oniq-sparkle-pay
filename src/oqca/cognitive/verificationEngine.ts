/**
 * VERIFICATION — §11. "No model output automatically becomes truth."
 *
 * The engine holds CLAIMS and the evidence for and against each. Its whole
 * job is to refuse to promote, and the one rule that does the work lives in
 * `promote()`: evidence whose source is `model` can never lift a claim past
 * SUPPORTED, however much of it there is. Two INDEPENDENT verifying sources
 * are what VERIFIED costs.
 *
 * WHY A SEPARATE ENGINE RATHER THAN A FLAG ON THE FACT. A claim can be argued
 * about by readings taken at different times from different tools, and the
 * argument is the thing worth keeping. Collapsing it to one boolean at write
 * time throws away exactly what a later reader needs to reopen it.
 */
import { type Provenance, type Standing, promote } from "./provenance.ts";

export type Claim = {
  readonly id: string;
  readonly statement: string;
  readonly supporting: readonly Provenance[];
  readonly contradicting: readonly Provenance[];
};

export type VerificationEngine = {
  readonly claims: readonly Claim[];
};

export const EMPTY_VERIFICATION: VerificationEngine = { claims: [] };

export function assert(v: VerificationEngine, id: string, statement: string): VerificationEngine {
  if (v.claims.some((c) => c.id === id)) return v;
  return { claims: [...v.claims, { id, statement, supporting: [], contradicting: [] }] };
}

export function support(v: VerificationEngine, id: string, p: Provenance): VerificationEngine {
  return {
    claims: v.claims.map((c) => (c.id === id ? { ...c, supporting: [...c.supporting, p] } : c)),
  };
}

export function contradict(v: VerificationEngine, id: string, p: Provenance): VerificationEngine {
  return {
    claims: v.claims.map((c) =>
      c.id === id ? { ...c, contradicting: [...c.contradicting, p] } : c,
    ),
  };
}

export function standing(v: VerificationEngine, id: string): Standing {
  const c = v.claims.find((x) => x.id === id);
  if (!c) return "UNPROVEN";
  return promote(c.supporting, c.contradicting);
}

/** Claims that reached VERIFIED. The only ones a caller may state flatly. */
export function verified(v: VerificationEngine): readonly Claim[] {
  return v.claims.filter((c) => standing(v, c.id) === "VERIFIED");
}
