// stillRoute — which engine draws a still, decided once, in the open.
//
// OWNER DIRECTIVE, 2026-09-01. Stills route to the Lovable gateway; the GPU
// is out of the still path. The owner's words were "I want old version back
// where in-house and Veo both was there without gpu" — the 14–27 August
// shape, where the still came from the gateway and motion was either ONIQ's
// own Ken Burns (classic) or Veo (movie).
//
// WHY A MODULE AND NOT AN `if`. The 2026-08-27 directive deleted the previous
// provider from story-still rather than leaving it as a fallback, and the
// reasoning behind that is still right: a stage that can silently outsource
// is worse than a stage that fails, because nobody finds out. Restoring a
// second engine therefore has to restore it as a CHOICE, not as a safety net.
//
// So the rule this file enforces, in both directions:
//
//     the chosen engine draws the frame, or nothing does.
//
// A gateway that is not configured does NOT fall through to the GPU, and a
// GPU that is not configured does NOT fall through to the gateway. Either
// answers `blocked` with the reason, story-still says so, and the film stops
// somewhere a human can read. That is the whole point of separating the
// decision from the call: it is pure, so it is tested rather than trusted.
//
// It is also why the engine that actually drew each frame travels back in
// every reply as `provider`. The failure mode this design is built against is
// not "the wrong engine ran" — it is "the wrong engine ran and the log said
// nothing", which is what happened on 2026-08-09.

/** What the operator may ask for, in STILL_PROVIDER. */
export type StillProvider = "gateway" | "in_house";

/** What the request actually does. `blocked` spends nothing. */
export type StillEngine = "gateway" | "in-house" | "blocked";

/**
 * The default when STILL_PROVIDER is unset — the 2026-09-01 directive, in
 * force. This is a STATED default, not a fallback: it is chosen before
 * anything is called and it never changes because something failed.
 */
export const DEFAULT_STILL_PROVIDER: StillProvider = "gateway";

/**
 * Read the operator's setting. An unrecognised value is `null` rather than a
 * quiet default: a typo in STILL_PROVIDER must not be indistinguishable from
 * an unset one, or the endpoint spends whichever pool the typo happens to
 * land on.
 */
export function readStillProvider(raw: string | null | undefined): StillProvider | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return DEFAULT_STILL_PROVIDER;
  if (v === "gateway" || v === "lovable" || v === "lovable-gateway") return "gateway";
  if (v === "in_house" || v === "in-house" || v === "gpu" || v === "runpod") return "in_house";
  return null;
}

export type StillRouteInput = {
  /** null means STILL_PROVIDER held something this file does not recognise. */
  provider: StillProvider | null;
  /** LOVABLE_API_KEY is present. */
  gatewayConfigured: boolean;
  /** RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID and R2_PUBLIC_BASE_URL are all present. */
  inHouseConfigured: boolean;
};

export type StillRoute = {
  engine: StillEngine;
  /** Machine-readable, and the same string goes in the log and the reply. */
  reason: string;
};

export function routeStill(input: StillRouteInput): StillRoute {
  if (input.provider === null) {
    return { engine: "blocked", reason: "still-provider-unrecognised" };
  }
  if (input.provider === "gateway") {
    return input.gatewayConfigured
      ? { engine: "gateway", reason: "still-provider-gateway" }
      : { engine: "blocked", reason: "gateway-not-configured" };
  }
  return input.inHouseConfigured
    ? { engine: "in-house", reason: "still-provider-in-house" }
    : { engine: "blocked", reason: "in-house-not-configured" };
}

/**
 * Whether this engine can hold a character's identity across shots, and how.
 *
 * Reported rather than assumed, because the two engines take a reference by
 * two different routes and a caller that cannot tell them apart cannot tell a
 * conditioned still from an unconditioned one:
 *
 *   in-house  the bucket KEY is handed to the worker, which reads it with the
 *             endpoint's own credentials.
 *   gateway   this side reads the same object over the bucket's public base
 *             and INLINES the bytes, because the gateway has no bucket.
 *
 * Both start from a characterRefId resolved against the server-side allowlist,
 * so neither ever accepts a path or a URL from a caller.
 */
export function referenceRouteFor(engine: StillEngine): "key" | "inline" | "none" {
  if (engine === "in-house") return "key";
  if (engine === "gateway") return "inline";
  return "none";
}
