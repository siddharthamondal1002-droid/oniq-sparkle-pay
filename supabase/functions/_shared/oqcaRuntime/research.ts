/**
 * THE RESEARCH ADAPTER — v1.3 section 12: "Never fabricate research."
 *
 * IT REFUSES, AND THAT IS THE WHOLE FILE. ONIQ has exactly one thing shaped
 * like research — `smart-scout`, which reaches a search-capable model — and it
 * is a LIVE, PAID, user-facing path. Wiring a scheduled cognitive tick into it
 * would be a provider-and-payment decision, which is the owner's under
 * CLAUDE.md's first rule and not an engineering call; and it would spend on
 * every tick, unattended, on a question the loop chose for itself.
 *
 * WHY THIS IS A REFUSAL AND NOT AN EMPTY RESULT, which is the only design
 * decision here worth arguing about: `ResearchResult` is a union so that
 * "I researched this and found nothing" and "I cannot research" are DIFFERENT
 * answers. An adapter that returned `{ ok: true, findings: [] }` would be
 * stating a negative result it never established — a fabricated finding, which
 * is exactly what section 12 forbids, arriving through the one door nobody
 * watches.
 *
 * The RESEARCH station turns this refusal into a KNOWLEDGE failure and hands it
 * to the recovery ladder with `researchAvailable: false`, so the ladder replans
 * instead of recommending the step that just refused.
 */
import type { ResearchAdapter } from "../oqca/loop/seams.ts";

export const RESEARCH_GAP =
  "no research capability is wired to a scheduled cognitive run: ONIQ's only " +
  "search-capable path is smart-scout, which is paid and user-facing, and " +
  "pointing an unattended loop at it is a spend decision the owner has not made";

export type ResearchContext = {
  readonly record: (note: { question: string; reason: string }) => void;
};

export function makeResearch(ctx: ResearchContext): ResearchAdapter {
  return {
    investigate: async (question) => {
      ctx.record({ question, reason: RESEARCH_GAP });
      return { ok: false, reason: RESEARCH_GAP };
    },
  };
}
