/**
 * WHICH ENGINE DRAWS A STILL — and, more importantly, what happens when the
 * chosen one is unavailable.
 *
 * The 2026-08-27 directive deleted story-still's second engine rather than
 * leaving it as a fallback, on the grounds that "a stage that can silently
 * outsource is the behaviour the directive ends". The 2026-09-01 directive
 * brings the gateway back and makes it the default — as a CHOICE. These tests
 * exist to keep those two facts from quietly merging into "try one, then the
 * other", which is the shape both directives were written against and the
 * shape a future edit will reach for first.
 *
 * The routing is a pure function precisely so this can be asserted rather than
 * argued about, and the source pins below cover the part of the rule that
 * lives in the handler instead of in the router.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STILL_PROVIDER,
  readStillProvider,
  referenceRouteFor,
  routeStill,
} from "../../../supabase/functions/_shared/stillRoute";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/story-still/index.ts"), "utf8");

const BOTH = { gatewayConfigured: true, inHouseConfigured: true };

describe("the chosen engine draws the frame, or nothing does", () => {
  it("never falls through to the GPU when the gateway is unconfigured", () => {
    const route = routeStill({
      provider: "gateway",
      gatewayConfigured: false,
      inHouseConfigured: true,
    });
    expect(route.engine).toBe("blocked");
    expect(route.reason).toBe("gateway-not-configured");
  });

  it("never falls through to the gateway when the GPU is unconfigured", () => {
    // The direction that matters most: the gateway spends money. A GPU
    // endpoint that is merely absent must not put a bill on Lovable credits.
    const route = routeStill({
      provider: "in_house",
      gatewayConfigured: true,
      inHouseConfigured: false,
    });
    expect(route.engine).toBe("blocked");
    expect(route.reason).toBe("in-house-not-configured");
  });

  it("routes to exactly what was asked for when it is available", () => {
    expect(routeStill({ provider: "gateway", ...BOTH }).engine).toBe("gateway");
    expect(routeStill({ provider: "in_house", ...BOTH }).engine).toBe("in-house");
  });

  it("blocks on an unrecognised STILL_PROVIDER instead of picking one", () => {
    // A typo must not be indistinguishable from an unset variable — otherwise
    // a slip in a dashboard field decides which account pays.
    expect(readStillProvider("gatewy")).toBeNull();
    expect(routeStill({ provider: null, ...BOTH })).toEqual({
      engine: "blocked",
      reason: "still-provider-unrecognised",
    });
  });
});

describe("reading the operator's setting", () => {
  it("defaults to the gateway when unset, per the 2026-09-01 directive", () => {
    expect(DEFAULT_STILL_PROVIDER).toBe("gateway");
    expect(readStillProvider(undefined)).toBe("gateway");
    expect(readStillProvider("")).toBe("gateway");
    expect(readStillProvider("   ")).toBe("gateway");
  });

  it("accepts the spellings someone will actually type", () => {
    for (const v of ["gateway", "GATEWAY", " Lovable ", "lovable-gateway"]) {
      expect(readStillProvider(v)).toBe("gateway");
    }
    for (const v of ["in_house", "in-house", "GPU", "runpod"]) {
      expect(readStillProvider(v)).toBe("in_house");
    }
  });
});

describe("the reference reaches each engine by the route that engine has", () => {
  it("hands the GPU a key and the gateway inlined bytes", () => {
    expect(referenceRouteFor("in-house")).toBe("key");
    expect(referenceRouteFor("gateway")).toBe("inline");
    expect(referenceRouteFor("blocked")).toBe("none");
  });
});

describe("the handler keeps the no-fallback rule the router cannot enforce", () => {
  it("chooses the engine BEFORE the prompt is even read", () => {
    // Ordering is the guard: a route decided after validation could be
    // re-decided by a failure. The route block must precede the body parse.
    const routeAt = SRC.indexOf("const route = routeStill(");
    const bodyAt = SRC.indexOf("const body = await req.json()");
    expect(routeAt).toBeGreaterThan(0);
    expect(bodyAt).toBeGreaterThan(0);
    expect(routeAt).toBeLessThan(bodyAt);
  });

  it("never calls the other engine from a failure handler", () => {
    // engineFailure is the one place a "well, try the other one" would be
    // written, because it is the only place that sees every engine failure.
    const from = SRC.indexOf("function engineFailure(");
    expect(from).toBeGreaterThan(0);
    const tail = SRC.slice(from);
    expect(tail).not.toContain("drawStillViaGateway");
    expect(tail).not.toContain("generateStill(");
    expect(tail).not.toContain("submitStill(");
  });

  it("names the engine that drew the frame in every success reply", () => {
    // A pipeline that can run on two engines and does not say which ran is
    // how a provider switch becomes invisible. Counted against `configured:
    // true` rather than pinned to a number, so a reply added later has to
    // carry the stamp too instead of merely moving the goalposts here.
    const stamped = SRC.split("...engineShape,").length - 1;
    const successes = SRC.split("configured: true").length - 1;
    expect(stamped).toBeGreaterThan(0);
    expect(stamped).toBe(successes);
    expect(SRC).toContain('provider: "gateway" as const');
    expect(SRC).toContain('provider: "in-house" as const');
  });

  it("still refuses caller-inlined reference bytes under both engines", () => {
    // The gateway takes inlined bytes — but only ones THIS side read from
    // ONIQ's own bucket. Accepting a caller's would restore the "source a new
    // face from anywhere" hole that characterRef.ts closed.
    const guard = SRC.indexOf("Inline reference bytes are not accepted");
    expect(guard).toBeGreaterThan(0);
    expect(SRC.indexOf("const usingGateway")).toBeLessThan(guard);
    expect(SRC).not.toContain("referenceDataUrl: referenceImage");
  });

  it("reports a failed reference fetch as unanchored, never as anchored", () => {
    // Reporting `conditioned` off the key alone would tell a caller a frame
    // was anchored when the fetch had failed — the exact lie the field exists
    // to prevent.
    expect(SRC).toContain("if (!referenceDataUrl) referenceKey = null;");
  });
});
