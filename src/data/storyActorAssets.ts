/**
 * Re-export of the actor asset map, which now lives in
 * supabase/functions/_shared/storyActorAssets.ts.
 *
 * It had to move: the Supabase edge bundler uploads only the supabase/functions
 * tree, so `characterRef.ts` importing `../../../src/data/storyActorAssets.ts`
 * type-checked, linted, tested and then failed at deploy time with
 * `Module not found` — story-still and story-reference-publish were both
 * rejected by production on 2026-08-31 while the two functions that do not
 * reach this module deployed normally.
 *
 * This path stays because six app-side modules and remotion/scripts/
 * story-worker.mjs import it, and storyActorRefWiring.test.ts pins the worker's
 * specifier literally. Re-exporting rather than duplicating keeps ONE copy of
 * the 67-actor map: two copies would drift, and the drift would show up as a
 * character silently losing its reference rather than as a failing test.
 */
export {
  ACTOR_ASSETS,
  ONIQ_ASSET_ORIGIN,
  assetUrl,
  referenceEligible,
} from "../../supabase/functions/_shared/storyActorAssets.ts";
export type { ActorAsset } from "../../supabase/functions/_shared/storyActorAssets.ts";
