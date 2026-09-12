import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appRoutes, doorsFound, normalisePath, routesWithDoors } from "../../test/doorGraph.ts";

/**
 * EVERY SCREEN MUST HAVE A DOOR, and this repo needs the guard because it has
 * shipped four features that did not:
 *
 *   /app/upi          "active" with no tile — reported as "no tabs, no icons"
 *   /app/creations    delete controls whose only inbound link was a back= on a
 *                     NOT-FOUND page
 *   health records    the picker one tab across, behind a label nobody reads as
 *                     "add a report"
 *   the admin tools   present, served, and never mounted
 *
 * CLAUDE.md's rule after the third was "grep for what LINKS to the screen", and
 * for the fourth that grep was RUN and came back empty: the tab is built from
 * `${HEALTH_ROUTE}/records`, which no literal search can see. So this evaluates
 * the app's own link expressions instead of searching for path strings — the
 * `upiDoors` pattern, applied to every route at once.
 */

/**
 * Screens with no door ON PURPOSE. Each needs a reason, and the list may only
 * SHRINK — `MAX_DOORLESS` is the ratchet, the same shape as
 * `eslint-suppressions.json`. Adding a route without a door means either
 * building the door or defending it here in writing.
 */
const ROUTES_WITHOUT_A_DOOR: Readonly<Record<string, string>> = {
  "/app/diag":
    "the [HW] hardware checks as a screen — answerable only on a real handset, " +
    "reached by typing the URL. Putting it in navigation would ship a developer " +
    "tool to 126 people.",
  "/app/jobs-apps":
    "a RETIRED route kept as a redirect, because it has shipped in the Android " +
    "build and may be linked from the Play listing. Its own header says so, and " +
    "tileVisibility.test.ts asserts it is absent from Home and from worlds.",
};

/** Measured 2026-09-12. It may fall; it may not rise without a deliberate edit here. */
const MAX_DOORLESS = 2;

describe("every screen has a way in", () => {
  it("no route is reachable only by typing its URL", () => {
    const withDoors = routesWithDoors();
    const orphans = appRoutes().filter((r) => !withDoors.has(r) && !(r in ROUTES_WITHOUT_A_DOOR));
    expect(orphans).toEqual([]);
  });

  it("keeps the doorless list shrinking, never growing", () => {
    expect(Object.keys(ROUTES_WITHOUT_A_DOOR).length).toBeLessThanOrEqual(MAX_DOORLESS);
  });

  it("gives every deliberate exception a reason someone can argue with", () => {
    for (const [route, reason] of Object.entries(ROUTES_WITHOUT_A_DOOR)) {
      expect(reason.length, `${route} needs a real reason`).toBeGreaterThan(40);
    }
  });

  /** An exception for a route that no longer exists is a stale defence. */
  it("does not defend a route that has been deleted", () => {
    const routes = new Set(appRoutes());
    for (const route of Object.keys(ROUTES_WITHOUT_A_DOOR)) {
      expect(routes.has(route), `${route} is defended but no longer exists`).toBe(true);
    }
  });
});

describe("the extractor sees the links that defeated a grep", () => {
  /**
   * THE CASE THAT MOTIVATED ALL OF THIS. `app.health.tsx` builds its tabs as
   * `` to: `${HEALTH_ROUTE}/records` ``, and searching for "/app/health/records"
   * returns only the route's own definition — which reads as "no door at all"
   * and is why the picker was reported missing.
   */
  it("resolves a link assembled from a route constant", () => {
    const doors = doorsFound().filter((d) => d.to === "/app/health/records");
    expect(doors.length).toBeGreaterThan(0);
    expect(doors.some((d) => d.from.includes("app.health"))).toBe(true);
  });

  /**
   * A RETURN IS NOT A DOOR, and this is the distinction the whole guard rests
   * on. In September `/app/creations` was referenced twice — both times as
   * `back="/app/creations"` on a not-found page, a way out of being lost rather
   * than a way in. Counting any mention would have called it reachable.
   */
  it("never counts a back= return as a door", () => {
    const src = readFileSync(
      resolve(__dirname, "../../routes/_authenticated/app.made.$kind.$id.tsx"),
      "utf8",
    );
    expect(src).toMatch(/back="\/app\/creations"/); // the fixture is real
    const fromNotFound = doorsFound().filter(
      (d) => d.from.includes("app.made.") && d.to === "/app/creations",
    );
    expect(fromNotFound).toEqual([]);
  });

  /** A screen linking to itself is not a way in. */
  it("never counts a route's link to itself", () => {
    for (const d of doorsFound()) {
      const own = /app\.([a-z0-9._$-]+)\.tsx$/.exec(d.from);
      if (!own) continue;
      const asPath = normalisePath("/app/" + own[1].replace(/\./g, "/"));
      expect(d.to, `${d.from} counted a self-link`).not.toBe(asPath);
    }
  });

  /** A guard that found nothing would pass every assertion above. */
  it("finds a substantial graph rather than silently finding nothing", () => {
    expect(doorsFound().length).toBeGreaterThan(100);
    expect(appRoutes().length).toBeGreaterThan(40);
  });
});
