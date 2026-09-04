/**
 * WHAT ONIQ CAN DO, for the screens.
 *
 * A RE-EXPORT, not a copy. The registry itself lives beside the code it
 * describes — supabase/functions/_shared/capabilityRegistry.ts — because
 * every entry's evidence is a measurement of an endpoint an edge function
 * calls. Two files would drift, and this one is specifically about not
 * letting a claim drift away from what was measured. Same shim shape
 * src/data/storyActorAssets.ts and src/lib/itemLint.ts already use.
 *
 * WHY A SCREEN NEEDS THIS AT ALL. Owner directive 2026-09-04c: a feature the
 * provider HAS and this account is not admitted to must read "Access
 * required", never "unavailable". A person told "unavailable" stops asking;
 * a person told "access required" knows there is a door. That sentence only
 * does its job if a screen actually renders it, which is what this shim is
 * for.
 */
export {
  CAPABILITIES,
  isLive,
  unavailableMessage,
} from "../../supabase/functions/_shared/capabilityRegistry.ts";
export type {
  CapabilityEntry,
  CapabilityId,
  CapabilityState,
} from "../../supabase/functions/_shared/capabilityRegistry.ts";
