/**
 * PHASE 8's requirement, made checkable: the PRODUCTION renderer must reach
 * routeMotion — not merely have a bridge available to it.
 *
 * The failure this guards against is the one the owner named: declaring the
 * work done because the module exists, while the film path still walks
 * straight into Veo. So this reads the real renderer that story-worker.yml
 * runs (`node scripts/story-worker.mjs`) and asserts the wiring is there,
 * ahead of the provider call, and fail-closed.
 */
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

const RENDERER = readFileSync(
  new URL("../../../remotion/scripts/story-worker.mjs", import.meta.url),
  "utf-8",
);

describe("the production renderer routes its motion", () => {
  it("imports routeMotion from the shared bridge", () => {
    expect(RENDERER).toMatch(
      /import \{ routeMotion \} from '\.\.\/\.\.\/supabase\/functions\/_shared\/inHouseMotion\.ts'/,
    );
  });

  it("consults the route INSIDE generateClip, before any provider call", () => {
    const fn = RENDERER.slice(
      RENDERER.indexOf("async function generateClip("),
      RENDERER.indexOf("Temporal-aliveness score"),
    );
    expect(fn).toContain("motionRoute()");
    const routedAt = fn.indexOf("motionRoute()");
    const veoAt = fn.indexOf("story-clip");
    expect(routedAt).toBeGreaterThan(-1);
    expect(veoAt).toBeGreaterThan(-1);
    expect(routedAt).toBeLessThan(veoAt);
  });

  it("requires all three signals — a healthy endpoint is not a deployed worker", () => {
    expect(RENDERER).toContain("IN_HOUSE_MOTION === 'on'");
    expect(RENDERER).toContain("ONIQ_GPU_HEALTHY === 'on'");
    expect(RENDERER).toContain("ONIQ_WORKER_IMAGE === 'on'");
  });

  it("treats a blocked route as a refusal, never as a reason to call Veo", () => {
    const fn = RENDERER.slice(
      RENDERER.indexOf("async function generateClip("),
      RENDERER.indexOf("Temporal-aliveness score"),
    );
    const blocked = fn.slice(fn.indexOf("route.engine === 'blocked'"));
    // The blocked branch must THROW before reaching the provider.
    expect(blocked.slice(0, 400)).toMatch(/throw new Error/);
    expect(blocked.slice(0, 400)).toContain("no provider fallback");
  });

  it("the in-house branch never falls through to the Veo branch", () => {
    const fn = RENDERER.slice(
      RENDERER.indexOf("async function generateClip("),
      RENDERER.indexOf("Temporal-aliveness score"),
    );
    const inHouse = fn.slice(fn.indexOf("route.engine === 'in-house'"));
    expect(inHouse.slice(0, 400)).toMatch(/throw new Error/);
    expect(inHouse.slice(0, 400)).toContain("no provider fallback");
  });
});
